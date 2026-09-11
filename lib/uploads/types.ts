// SPDX-License-Identifier: AGPL-3.0-only

/** On-disk namespace under `uploads/{bucket}/`. Extend when new attachment kinds land. */
export type UploadBucket = "people"

export const UPLOAD_BUCKETS: readonly UploadBucket[] = ["people"] as const

export type UploadMeta = {
  filename: string
  sizeBytes: number
  encrypted: boolean
}

/**
 * Raw blob I/O only — no crypto. The upload store facade applies mode/key/FCE1.
 */
export type UploadBlobAdapter = {
  get(bucket: UploadBucket, filename: string): Promise<Buffer | null>
  put(bucket: UploadBucket, filename: string, data: Buffer): Promise<void>
  /** @returns false when the file was already absent */
  delete(bucket: UploadBucket, filename: string): Promise<boolean>
  list(bucket: UploadBucket): Promise<Array<{ filename: string; sizeBytes: number }>>
  /** First `byteCount` bytes, or null if missing. Used for FCE1 magic peek. */
  head(bucket: UploadBucket, filename: string, byteCount: number): Promise<Buffer | null>
}
