// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { __setFileKeyForTests } from "@/lib/encryption/file-key"
import {
  __setUploadBlobAdapterForTests,
  createMemoryUploadBlobAdapter,
  deleteUpload,
  InvalidUploadFilenameError,
  listUploadMeta,
  readUpload,
  writeUpload,
} from "@/lib/uploads/store"

const KEY_HEX = "a".repeat(64)

describe("upload store", () => {
  const prevMode = process.env.FC_ENCRYPTION_MODE

  beforeEach(() => {
    __setUploadBlobAdapterForTests(createMemoryUploadBlobAdapter())
    __setFileKeyForTests(null)
    delete process.env.FC_ENCRYPTION_MODE
  })

  afterEach(() => {
    __setUploadBlobAdapterForTests(null)
    __setFileKeyForTests(null)
    if (prevMode === undefined) delete process.env.FC_ENCRYPTION_MODE
    else process.env.FC_ENCRYPTION_MODE = prevMode
  })

  it("rejects unsafe filenames", async () => {
    await expect(readUpload("people", "../x.jpg")).rejects.toBeInstanceOf(InvalidUploadFilenameError)
    await expect(writeUpload("people", "a/b.jpg", Buffer.from("x"))).rejects.toBeInstanceOf(
      InvalidUploadFilenameError,
    )
  })

  it("round-trips plaintext when encryption mode is none", async () => {
    const plain = Buffer.from([0xff, 0xd8, 0xff, 0x01])
    await writeUpload("people", "shot.jpg", plain)
    const got = await readUpload("people", "shot.jpg")
    expect(got?.equals(plain)).toBe(true)
    const meta = await listUploadMeta("people")
    expect(meta).toEqual([{ filename: "shot.jpg", sizeBytes: plain.length, encrypted: false }])
  })

  it("encrypts on write and decrypts on read when mode is env", async () => {
    process.env.FC_ENCRYPTION_MODE = "env"
    __setFileKeyForTests(KEY_HEX)
    const plain = Buffer.from("photo-bytes")
    await writeUpload("people", "enc.jpg", plain)

    const meta = await listUploadMeta("people")
    expect(meta[0]?.encrypted).toBe(true)

    const got = await readUpload("people", "enc.jpg")
    expect(got?.equals(plain)).toBe(true)
  })

  it("returns null for missing files", async () => {
    expect(await readUpload("people", "missing.jpg")).toBeNull()
  })

  it("throws on undecryptable ciphertext (does not return null)", async () => {
    process.env.FC_ENCRYPTION_MODE = "env"
    __setFileKeyForTests(KEY_HEX)
    await writeUpload("people", "bad.jpg", Buffer.from("ok"))

    __setFileKeyForTests("b".repeat(64))
    await expect(readUpload("people", "bad.jpg")).rejects.toThrow()
  })

  it("delete returns false when absent", async () => {
    expect(await deleteUpload("people", "gone.jpg")).toBe(false)
    await writeUpload("people", "gone.jpg", Buffer.from("x"))
    expect(await deleteUpload("people", "gone.jpg")).toBe(true)
    expect(await deleteUpload("people", "gone.jpg")).toBe(false)
  })

  it("rejects a plaintext file in an encrypted bucket and leaves it unchanged", async () => {
    const adapter = createMemoryUploadBlobAdapter()
    __setUploadBlobAdapterForTests(adapter)
    const plain = Buffer.from("legacy-photo")
    await adapter.put("people", "legacy.jpg", plain)

    process.env.FC_ENCRYPTION_MODE = "env"
    __setFileKeyForTests(KEY_HEX)

    await expect(readUpload("people", "legacy.jpg")).rejects.toThrow(
      "Not an encrypted upload (missing FCE1 header)",
    )
    const raw = await adapter.get("people", "legacy.jpg")
    expect(raw?.equals(plain)).toBe(true)
  })
})
