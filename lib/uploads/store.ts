// SPDX-License-Identifier: AGPL-3.0-only

import { createHash } from "crypto"
import { logger } from "@/lib/logger"
import {
  decryptUploadBuffer,
  encryptUploadBuffer,
  fileKeyBytesFromPassphrase,
  FILE_CIPHER_MAGIC,
  isEncryptedUploadBuffer,
  readUploadBuffer,
} from "@/lib/encryption/file-crypto"
import { getFileKey, getFileKeyOrNull } from "@/lib/encryption/file-key"
import { encryptionActive, getEncryptionMode } from "@/lib/encryption/mode"
import { createDiskUploadBlobAdapter } from "./disk-adapter"
import type { UploadBlobAdapter, UploadBucket, UploadMeta } from "./types"
import { UPLOAD_BUCKETS } from "./types"

export type { UploadBucket, UploadMeta, UploadBlobAdapter } from "./types"
export { UPLOAD_BUCKETS } from "./types"
export { createMemoryUploadBlobAdapter } from "./memory-adapter"

export class InvalidUploadFilenameError extends Error {
  constructor(filename: string) {
    super(`Invalid upload filename: ${filename}`)
    this.name = "InvalidUploadFilenameError"
  }
}

const diskAdapter = createDiskUploadBlobAdapter()
let blobAdapter: UploadBlobAdapter = diskAdapter

/** Test-only: replace the raw blob adapter (pass `null` to restore disk). */
export function __setUploadBlobAdapterForTests(next: UploadBlobAdapter | null): void {
  blobAdapter = next ?? diskAdapter
}

export function assertSafeUploadFilename(filename: string): void {
  if (
    !filename ||
    filename !== filename.trim() ||
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.endsWith(".fce1.tmp")
  ) {
    throw new InvalidUploadFilenameError(filename)
  }
}

function resolveFileKeyBytes(): Buffer | null {
  const passphrase = getFileKeyOrNull()
  return passphrase ? fileKeyBytesFromPassphrase(passphrase) : null
}

/**
 * Read and decrypt (if FCE1) an upload. Returns null when missing.
 * Throws on invalid filename or undecryptable ciphertext.
 */
export async function readUpload(bucket: UploadBucket, filename: string): Promise<Buffer | null> {
  assertSafeUploadFilename(filename)
  const onDisk = await blobAdapter.get(bucket, filename)
  if (!onDisk) return null
  return readUploadBuffer(onDisk, resolveFileKeyBytes())
}

/** Encrypt when mode is active, then store plaintext or ciphertext bytes. */
export async function writeUpload(
  bucket: UploadBucket,
  filename: string,
  plaintext: Buffer,
): Promise<void> {
  assertSafeUploadFilename(filename)
  let toStore = plaintext
  if (encryptionActive(getEncryptionMode())) {
    toStore = Buffer.from(
      encryptUploadBuffer(plaintext, fileKeyBytesFromPassphrase(getFileKey())),
    )
  }
  await blobAdapter.put(bucket, filename, toStore)
}

/** @returns false when the file was already absent */
export async function deleteUpload(bucket: UploadBucket, filename: string): Promise<boolean> {
  assertSafeUploadFilename(filename)
  return blobAdapter.delete(bucket, filename)
}

/** Metadata only — never decrypts. `encrypted` is an FCE1 magic peek. */
export async function listUploadMeta(bucket: UploadBucket): Promise<UploadMeta[]> {
  const entries = await blobAdapter.list(bucket)
  const out: UploadMeta[] = []
  for (const { filename, sizeBytes } of entries) {
    try {
      assertSafeUploadFilename(filename)
    } catch {
      continue
    }
    const head = await blobAdapter.head(bucket, filename, 4)
    const encrypted = Boolean(head && head.length >= 4 && head.equals(FILE_CIPHER_MAGIC))
    out.push({ filename, sizeBytes, encrypted })
  }
  return out
}

/**
 * Boot migration: encrypt plaintext files in all registered buckets when
 * encryption mode is active. Source of truth is the directory (orphans included).
 */
export async function migratePlaintextUploads(): Promise<{ migrated: number; skipped: number }> {
  if (!encryptionActive(getEncryptionMode())) {
    return { migrated: 0, skipped: 0 }
  }

  const key = fileKeyBytesFromPassphrase(getFileKey())
  let migrated = 0
  let skipped = 0

  for (const bucket of UPLOAD_BUCKETS) {
    const entries = await blobAdapter.list(bucket)
    for (const { filename } of entries) {
      try {
        assertSafeUploadFilename(filename)
      } catch {
        skipped++
        continue
      }
      const buf = await blobAdapter.get(bucket, filename)
      if (!buf) {
        skipped++
        continue
      }
      if (isEncryptedUploadBuffer(buf)) {
        skipped++
        continue
      }

      const encrypted = encryptUploadBuffer(buf, key)
      const verified = decryptUploadBuffer(encrypted, key)
      const inHash = createHash("sha256").update(buf).digest("hex")
      const outHash = createHash("sha256").update(verified).digest("hex")
      if (inHash !== outHash) {
        throw new Error(`Upload migration hash mismatch for ${bucket}/${filename}`)
      }

      await blobAdapter.put(bucket, filename, Buffer.from(encrypted))
      migrated++
    }
  }

  if (migrated > 0) {
    logger.info(`Encrypted ${migrated} plaintext upload file(s) under uploads/`)
  }
  return { migrated, skipped }
}
