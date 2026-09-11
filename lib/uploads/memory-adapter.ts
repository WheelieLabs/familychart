// SPDX-License-Identifier: AGPL-3.0-only

import type { UploadBlobAdapter, UploadBucket } from "./types"

function key(bucket: UploadBucket, filename: string): string {
  return `${bucket}/${filename}`
}

/** In-memory raw blob adapter for unit tests. */
export function createMemoryUploadBlobAdapter(): UploadBlobAdapter {
  const blobs = new Map<string, Buffer>()

  return {
    async get(bucket, filename) {
      const buf = blobs.get(key(bucket, filename))
      return buf ? Buffer.from(buf) : null
    },

    async put(bucket, filename, data) {
      blobs.set(key(bucket, filename), Buffer.from(data))
    },

    async delete(bucket, filename) {
      return blobs.delete(key(bucket, filename))
    },

    async list(bucket) {
      const prefix = `${bucket}/`
      const out: { filename: string; sizeBytes: number }[] = []
      for (const [k, buf] of blobs) {
        if (!k.startsWith(prefix)) continue
        const filename = k.slice(prefix.length)
        out.push({ filename, sizeBytes: buf.length })
      }
      out.sort((a, b) => a.filename.localeCompare(b.filename))
      return out
    },

    async head(bucket, filename, byteCount) {
      const buf = blobs.get(key(bucket, filename))
      if (!buf) return null
      return Buffer.from(buf.subarray(0, Math.min(byteCount, buf.length)))
    },
  }
}
