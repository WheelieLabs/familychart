// SPDX-License-Identifier: AGPL-3.0-only

import { createCipheriv, createDecipheriv, randomBytes } from "crypto"

/** On-disk magic for FamilyChart encrypted uploads (AES-256-GCM). */
export const FILE_CIPHER_MAGIC = Buffer.from("FCE1")
export const FILE_CIPHER_VERSION = 0x01
const NONCE_LEN = 12
const TAG_LEN = 16
const HEADER_LEN = 4 + 1 + NONCE_LEN // magic + version + nonce

/**
 * Parse 64-char hex (32-byte) file key material. Never log the return value.
 */
export function fileKeyBytesFromPassphrase(passphrase: string): Buffer {
  const trimmed = passphrase.trim()
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error("File encryption key must be 64 hex characters (32 bytes)")
  }
  return Buffer.from(trimmed, "hex")
}

export function isEncryptedUploadBuffer(buf: Buffer): boolean {
  return buf.length >= HEADER_LEN + TAG_LEN && buf.subarray(0, 4).equals(FILE_CIPHER_MAGIC)
}

/** Encrypt plaintext → FCE1 | version | nonce | ciphertext‖tag */
export function encryptUploadBuffer(plaintext: Buffer, key: Buffer): Buffer {
  if (key.length !== 32) throw new Error("AES-256-GCM key must be 32 bytes")
  const nonce = randomBytes(NONCE_LEN)
  const cipher = createCipheriv("aes-256-gcm", key, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([
    FILE_CIPHER_MAGIC,
    Buffer.from([FILE_CIPHER_VERSION]),
    nonce,
    ciphertext,
    tag,
  ])
}

/** Decrypt FCE1 blob → plaintext. Throws on format/auth failure. */
export function decryptUploadBuffer(blob: Buffer, key: Buffer): Buffer {
  if (key.length !== 32) throw new Error("AES-256-GCM key must be 32 bytes")
  if (!isEncryptedUploadBuffer(blob)) {
    throw new Error("Not an encrypted upload (missing FCE1 header)")
  }
  const version = blob[4]
  if (version !== FILE_CIPHER_VERSION) {
    throw new Error(`Unsupported upload cipher version: ${version}`)
  }
  const nonce = blob.subarray(5, 5 + NONCE_LEN)
  const tag = blob.subarray(blob.length - TAG_LEN)
  const ciphertext = blob.subarray(5 + NONCE_LEN, blob.length - TAG_LEN)
  const decipher = createDecipheriv("aes-256-gcm", key, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

/**
 * If blob is FCE1-encrypted, decrypt; otherwise return as legacy plaintext.
 * Callers must only pass `key` when a file key is available.
 */
export function readUploadBuffer(blob: Buffer, key: Buffer | null): Buffer {
  if (!isEncryptedUploadBuffer(blob)) return blob
  if (!key) {
    throw new Error("Encrypted upload present but file encryption key not available")
  }
  return decryptUploadBuffer(blob, key)
}
