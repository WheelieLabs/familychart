// SPDX-License-Identifier: AGPL-3.0-only

import {
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
 * Read an upload. Returns null when missing.
 * Encryption mode `none` returns a non-FCE1 blob as stored.
 * An active mode decrypts FCE1 and refuses anything else.
 * Throws on invalid filename or undecryptable ciphertext.
 */
export async function readUpload(bucket: UploadBucket, filename: string): Promise<Buffer | null> {
  assertSafeUploadFilename(filename)
  const onDisk = await blobAdapter.get(bucket, filename)
  if (!onDisk) return null
  if (!encryptionActive(getEncryptionMode()) && !isEncryptedUploadBuffer(onDisk)) {
    return onDisk
  }
  return readUploadBuffer(onDisk, resolveFileKeyBytes())
}

/** Stored size of one upload, or null when the file is absent. Does not decrypt. */
export async function uploadByteSize(bucket: UploadBucket, filename: string): Promise<number | null> {
  assertSafeUploadFilename(filename)
  const entries = await blobAdapter.list(bucket)
  return entries.find(entry => entry.filename === filename)?.sizeBytes ?? null
}

/** Whether an upload is present, without reading or decrypting its content. */
export async function uploadExists(bucket: UploadBucket, filename: string): Promise<boolean> {
  assertSafeUploadFilename(filename)
  return (await blobAdapter.head(bucket, filename, 1)) !== null
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
