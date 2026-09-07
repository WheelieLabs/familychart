// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest"
import { randomBytes } from "crypto"
import {
  decryptUploadBuffer,
  encryptUploadBuffer,
  fileKeyBytesFromPassphrase,
  isEncryptedUploadBuffer,
  readUploadBuffer,
  FILE_CIPHER_MAGIC,
} from "@/lib/encryption/file-crypto"

const KEY_HEX = "a".repeat(64)

describe("file-crypto", () => {
  it("round-trips AES-256-GCM with FCE1 header", () => {
    const key = fileKeyBytesFromPassphrase(KEY_HEX)
    const plain = Buffer.from("hello photo bytes")
    const enc = encryptUploadBuffer(plain, key)
    expect(isEncryptedUploadBuffer(enc)).toBe(true)
    expect(enc.subarray(0, 4).equals(FILE_CIPHER_MAGIC)).toBe(true)
    expect(decryptUploadBuffer(enc, key).equals(plain)).toBe(true)
  })

  it("rejects wrong key", () => {
    const key = fileKeyBytesFromPassphrase(KEY_HEX)
    const other = fileKeyBytesFromPassphrase("b".repeat(64))
    const enc = encryptUploadBuffer(randomBytes(32), key)
    expect(() => decryptUploadBuffer(enc, other)).toThrow()
  })

  it("readUploadBuffer leaves plaintext alone", () => {
    const plain = Buffer.from([0xff, 0xd8, 0xff]) // not FCE1
    expect(readUploadBuffer(plain, null).equals(plain)).toBe(true)
  })

  it("rejects non-hex passphrase", () => {
    expect(() => fileKeyBytesFromPassphrase("short")).toThrow(/64 hex/)
  })
})
