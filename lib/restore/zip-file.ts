// SPDX-License-Identifier: AGPL-3.0-only

import { closeSync, fstatSync, openSync, readSync } from "fs"
import { inflateRawSync } from "zlib"
import { ARCHIVE_STRUCTURE_INVALID, ENTRY_TOO_LARGE, NOT_AN_EXPORT } from "./messages"
import { restoreMaxUploadBytes } from "./upload-limit"

const LOCAL = 0x04034b50
const CENTRAL = 0x02014b50
const EOCD = 0x06054b50

/** Inflated-size caps for the two entries read before any content is trusted. */
export const MANIFEST_MAX_BYTES = 1024 * 1024
export const HOUSEHOLD_MAX_BYTES = 16 * 1024 * 1024

const ZIP64_U32 = 0xffffffff
const ZIP64_U16 = 0xffff
const CENTRAL_HEADER_BYTES = 46

export interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

export class ZipReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ZipReadError"
  }
}

/** Reads one zip on disk from its central directory, one entry at a time. */
export class ZipFile {
  private readonly fd: number

  private constructor(fd: number, readonly entries: ZipEntry[], private readonly fileSize: number) {
    this.fd = fd
  }

  static open(path: string): ZipFile {
    const fd = openSync(path, "r")
    try {
      const fileSize = fstatSync(fd).size
      return new ZipFile(fd, readCentralDirectory(fd, fileSize), fileSize)
    } catch (err) {
      closeSync(fd)
      throw err
    }
  }

  close(): void {
    closeSync(this.fd)
  }

  /**
   * Bytes of one entry, or null when the archive has no such name. The declared size is checked
   * against `maxBytes` (default: the upload limit) before anything is inflated, inflation is
   * bounded to the declared size, and the result must match it.
   */
  read(name: string, options: { maxBytes?: number } = {}): Buffer | null {
    const entry = this.entries.find(e => e.name === name)
    if (!entry) return null
    const cap = options.maxBytes ?? restoreMaxUploadBytes()
    if (entry.uncompressedSize > cap) throw new ZipReadError(ENTRY_TOO_LARGE)
    if (entry.compressedSize > this.fileSize) throw new ZipReadError(ARCHIVE_STRUCTURE_INVALID)
    if (entry.localHeaderOffset + 30 > this.fileSize) throw new ZipReadError(ARCHIVE_STRUCTURE_INVALID)
    const header = readAt(this.fd, entry.localHeaderOffset, 30)
    if (header.length < 30 || header.readUInt32LE(0) !== LOCAL) {
      throw new ZipReadError(NOT_AN_EXPORT)
    }
    const nameLen = header.readUInt16LE(26)
    const extraLen = header.readUInt16LE(28)
    const dataOffset = entry.localHeaderOffset + 30 + nameLen + extraLen
    if (dataOffset + entry.compressedSize > this.fileSize) throw new ZipReadError(ARCHIVE_STRUCTURE_INVALID)
    const compressed = readAt(this.fd, dataOffset, entry.compressedSize)
    if (compressed.length !== entry.compressedSize) {
      throw new ZipReadError(NOT_AN_EXPORT)
    }
    if (entry.method === 0) {
      if (compressed.length !== entry.uncompressedSize) throw new ZipReadError(ARCHIVE_STRUCTURE_INVALID)
      return compressed
    }
    if (entry.method === 8) {
      let inflated: Buffer
      try {
        inflated = inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.uncompressedSize) })
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") throw new ZipReadError(ENTRY_TOO_LARGE)
        throw new ZipReadError(NOT_AN_EXPORT)
      }
      if (inflated.length !== entry.uncompressedSize) throw new ZipReadError(ARCHIVE_STRUCTURE_INVALID)
      return inflated
    }
    throw new ZipReadError(NOT_AN_EXPORT)
  }
}

function readAt(fd: number, offset: number, length: number): Buffer {
  const buf = Buffer.alloc(length)
  let got = 0
  while (got < length) {
    const n = readSync(fd, buf, got, length - got, offset + got)
    if (n === 0) break
    got += n
  }
  return got === length ? buf : buf.subarray(0, got)
}

function readCentralDirectory(fd: number, size: number): ZipEntry[] {
  if (size < 22) throw new ZipReadError("This file is not a FamilyChart export")
  const tailLen = Math.min(size, 22 + 65535)
  const tail = readAt(fd, size - tailLen, tailLen)
  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== EOCD) continue
    const commentLen = tail.readUInt16LE(i + 20)
    if (i + 22 + commentLen === tail.length) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ZipReadError("This file is not a FamilyChart export")
  const count = tail.readUInt16LE(eocd + 10)
  const dirSize = tail.readUInt32LE(eocd + 12)
  const dirOffset = tail.readUInt32LE(eocd + 16)
  // Validate every declared size against the real file before allocating for it. zip64 is not
  // supported: its sentinel values are rejected rather than followed.
  const eocdPosition = size - tailLen + eocd
  if (
    count === ZIP64_U16 || dirSize === ZIP64_U32 || dirOffset === ZIP64_U32 ||
    dirOffset + dirSize > eocdPosition ||
    count * CENTRAL_HEADER_BYTES > dirSize
  ) {
    throw new ZipReadError(ARCHIVE_STRUCTURE_INVALID)
  }
  const dir = readAt(fd, dirOffset, dirSize)
  if (dir.length !== dirSize) throw new ZipReadError(NOT_AN_EXPORT)

  const entries: ZipEntry[] = []
  let pos = 0
  for (let n = 0; n < count; n++) {
    if (pos + 46 > dir.length || dir.readUInt32LE(pos) !== CENTRAL) {
      throw new ZipReadError(NOT_AN_EXPORT)
    }
    const method = dir.readUInt16LE(pos + 10)
    const compressedSize = dir.readUInt32LE(pos + 20)
    const uncompressedSize = dir.readUInt32LE(pos + 24)
    const nameLen = dir.readUInt16LE(pos + 28)
    const extraLen = dir.readUInt16LE(pos + 30)
    const commentLen = dir.readUInt16LE(pos + 32)
    const localHeaderOffset = dir.readUInt32LE(pos + 42)
    if (compressedSize === ZIP64_U32 || uncompressedSize === ZIP64_U32 || localHeaderOffset === ZIP64_U32) {
      throw new ZipReadError(ARCHIVE_STRUCTURE_INVALID)
    }
    if (pos + CENTRAL_HEADER_BYTES + nameLen + extraLen + commentLen > dir.length) {
      throw new ZipReadError(ARCHIVE_STRUCTURE_INVALID)
    }
    const name = dir.subarray(pos + 46, pos + 46 + nameLen).toString("utf8")
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset })
    pos += 46 + nameLen + extraLen + commentLen
  }
  return entries
}
