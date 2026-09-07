// SPDX-License-Identifier: AGPL-3.0-only

import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "fs/promises"
import path from "path"
import { getDataDir } from "@/lib/db"
import type { UploadBlobAdapter, UploadBucket } from "./types"

function bucketDir(bucket: UploadBucket): string {
  return path.join(getDataDir(), "uploads", bucket)
}

function fullPath(bucket: UploadBucket, filename: string): string {
  return path.join(bucketDir(bucket), filename)
}

/** Production disk adapter under `<dataDir>/uploads/{bucket}/`. */
export function createDiskUploadBlobAdapter(): UploadBlobAdapter {
  return {
    async get(bucket, filename) {
      try {
        return await readFile(fullPath(bucket, filename))
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
        throw err
      }
    },

    async put(bucket, filename, data) {
      const dir = bucketDir(bucket)
      await mkdir(dir, { recursive: true })
      const dest = fullPath(bucket, filename)
      const tmp = `${dest}.fce1.tmp`
      await writeFile(tmp, data)
      await rename(tmp, dest)
    },

    async delete(bucket, filename) {
      try {
        await unlink(fullPath(bucket, filename))
        return true
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return false
        throw err
      }
    },

    async list(bucket) {
      const dir = bucketDir(bucket)
      let names: string[]
      try {
        names = await readdir(dir)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return []
        throw err
      }
      const out: { filename: string; sizeBytes: number }[] = []
      for (const filename of names) {
        if (filename.endsWith(".fce1.tmp")) continue
        try {
          const st = await stat(path.join(dir, filename))
          if (!st.isFile()) continue
          out.push({ filename, sizeBytes: st.size })
        } catch {
          continue
        }
      }
      out.sort((a, b) => a.filename.localeCompare(b.filename))
      return out
    },

    async head(bucket, filename, byteCount) {
      try {
        const fh = await open(fullPath(bucket, filename), "r")
        try {
          const buf = Buffer.alloc(byteCount)
          const { bytesRead } = await fh.read(buf, 0, byteCount, 0)
          return buf.subarray(0, bytesRead)
        } finally {
          await fh.close()
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
        throw err
      }
    },
  }
}
