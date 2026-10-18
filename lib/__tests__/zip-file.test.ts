// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { deflateRawSync } from "zlib"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { HOUSEHOLD_MAX_BYTES, MANIFEST_MAX_BYTES, ZipFile, ZipReadError } from "@/lib/restore/zip-file"
import { ARCHIVE_STRUCTURE_INVALID, ENTRY_TOO_LARGE } from "@/lib/restore/messages"

interface RawEntry {
  name: string
  data: Buffer
  /** Stored (0) or deflate (8); default 8. */
  method?: 0 | 8
  /** Override the sizes the headers declare. */
  declaredUncompressed?: number
  declaredCompressed?: number
}

/** Builds a zip byte-for-byte so a header can lie about sizes. */
function buildZip(entries: RawEntry[], eocdOverrides: { count?: number; dirSize?: number; dirOffset?: number } = {}): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const method = entry.method ?? 8
    const body = method === 8 ? deflateRawSync(entry.data) : entry.data
    const compressedSize = entry.declaredCompressed ?? body.length
    const uncompressedSize = entry.declaredUncompressed ?? entry.data.length
    const name = Buffer.from(entry.name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(compressedSize, 18)
    local.writeUInt32LE(uncompressedSize, 22)
    local.writeUInt16LE(name.length, 26)
    parts.push(local, name, body)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(20, 4)
    c.writeUInt16LE(20, 6)
    c.writeUInt16LE(method, 10)
    c.writeUInt32LE(compressedSize, 20)
    c.writeUInt32LE(uncompressedSize, 24)
    c.writeUInt16LE(name.length, 28)
    c.writeUInt32LE(offset, 42)
    central.push(c, name)
    offset += local.length + name.length + body.length
  }
  const dir = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(eocdOverrides.count ?? entries.length, 8)
  eocd.writeUInt16LE(eocdOverrides.count ?? entries.length, 10)
  eocd.writeUInt32LE(eocdOverrides.dirSize ?? dir.length, 12)
  eocd.writeUInt32LE(eocdOverrides.dirOffset ?? offset, 16)
  return Buffer.concat([...parts, dir, eocd])
}

describe("ZipFile bounds", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fc-zip-"))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function open(bytes: Buffer): ZipFile {
    const path = join(dir, "t.zip")
    writeFileSync(path, bytes)
    return ZipFile.open(path)
  }

  function expectReadError(fn: () => unknown, message: string) {
    try {
      fn()
    } catch (err) {
      expect(err).toBeInstanceOf(ZipReadError)
      expect((err as Error).message).toBe(message)
      return
    }
    throw new Error("expected a ZipReadError")
  }

  it("reads stored and deflated entries that match their declared size", () => {
    const zip = open(buildZip([
      { name: "a.txt", data: Buffer.from("hello") },
      { name: "b.bin", data: Buffer.from("world"), method: 0 },
    ]))
    expect(zip.read("a.txt")!.toString()).toBe("hello")
    expect(zip.read("b.bin")!.toString()).toBe("world")
    expect(zip.read("missing")).toBeNull()
    zip.close()
  })

  it("rejects a 22-byte end-of-directory file declaring a huge directory", () => {
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt32LE(0xfffffff0, 12)
    eocd.writeUInt16LE(1, 10)
    expectReadError(() => open(eocd), ARCHIVE_STRUCTURE_INVALID)
  })

  it("rejects a deflate bomb whose header declares 10 bytes", () => {
    const zip = open(buildZip([{ name: "manifest.json", data: Buffer.alloc(50 * 1024 * 1024), declaredUncompressed: 10 }]))
    expectReadError(() => zip.read("manifest.json", { maxBytes: MANIFEST_MAX_BYTES }), ENTRY_TOO_LARGE)
    zip.close()
  })

  it("rejects an inflated length that differs from the declared size", () => {
    const zip = open(buildZip([{ name: "a.txt", data: Buffer.from("hello world"), declaredUncompressed: 400 }]))
    expectReadError(() => zip.read("a.txt"), ARCHIVE_STRUCTURE_INVALID)
    const stored = open(buildZip([{ name: "b.txt", data: Buffer.from("hello"), method: 0, declaredUncompressed: 3 }]))
    expectReadError(() => stored.read("b.txt"), ARCHIVE_STRUCTURE_INVALID)
    zip.close()
    stored.close()
  })

  it("rejects manifest and household entries over their caps but reads a large attachment under the upload cap", () => {
    const manifest = open(buildZip([{ name: "manifest.json", data: Buffer.alloc(MANIFEST_MAX_BYTES + 1, 0x20) }]))
    expectReadError(() => manifest.read("manifest.json", { maxBytes: MANIFEST_MAX_BYTES }), ENTRY_TOO_LARGE)
    manifest.close()
    const household = open(buildZip([{ name: "household.json", data: Buffer.alloc(HOUSEHOLD_MAX_BYTES + 1, 0x20) }]))
    expectReadError(() => household.read("household.json", { maxBytes: HOUSEHOLD_MAX_BYTES }), ENTRY_TOO_LARGE)
    household.close()
    const attachment = open(buildZip([{ name: "attachments/report-1.pdf", data: Buffer.alloc(HOUSEHOLD_MAX_BYTES + 5, 1) }]))
    expect(attachment.read("attachments/report-1.pdf")!.length).toBe(HOUSEHOLD_MAX_BYTES + 5)
    attachment.close()
  })

  it("rejects an entry count the directory cannot hold", () => {
    expectReadError(() => open(buildZip([{ name: "a", data: Buffer.from("x") }], { count: 5000 })), ARCHIVE_STRUCTURE_INVALID)
  })

  it("rejects a directory or compressed size that runs past the file", () => {
    expectReadError(() => open(buildZip([{ name: "a", data: Buffer.from("x") }], { dirSize: 10_000_000 })), ARCHIVE_STRUCTURE_INVALID)
    const zip = open(buildZip([{ name: "a", data: Buffer.from("x"), declaredCompressed: 900_000_000 }]))
    expectReadError(() => zip.read("a"), ARCHIVE_STRUCTURE_INVALID)
    zip.close()
  })

  it("rejects zip64 sentinels cleanly", () => {
    expectReadError(() => open(buildZip([{ name: "a", data: Buffer.from("x") }], { count: 0xffff })), ARCHIVE_STRUCTURE_INVALID)
    expectReadError(() => open(buildZip([{ name: "a", data: Buffer.from("x"), declaredUncompressed: 0xffffffff }])), ARCHIVE_STRUCTURE_INVALID)
  })
})
