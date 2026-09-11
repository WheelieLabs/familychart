// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { logger } from "@/lib/logger"
import { isValidPersonPhotoUploadUrl } from "@/lib/person/person-photo-url"
import { deleteUpload, InvalidUploadFilenameError } from "@/lib/uploads/store"

/** Extract filename from `/api/uploads/{filename}` or null if not a local upload URL. */
export function filenameFromPhotoUrl(photoUrl: string | null | undefined): string | null {
  if (!photoUrl || !isValidPersonPhotoUploadUrl(photoUrl)) return null
  const name = photoUrl.slice("/api/uploads/".length)
  if (name.includes("..") || name.includes("/") || name.includes("\\")) return null
  return name
}

/**
 * After a successful photo_url change, delete the previous on-disk file when no
 * other person still references it.
 */
export async function deleteSupersededPersonPhoto(
  db: Database.Database,
  previousPhotoUrl: string | null | undefined,
  nextPhotoUrl: string | null | undefined,
): Promise<void> {
  if (!previousPhotoUrl || previousPhotoUrl === nextPhotoUrl) return
  const filename = filenameFromPhotoUrl(previousPhotoUrl)
  if (!filename) return

  const stillReferenced = db
    .prepare("SELECT id FROM people WHERE photo_url = ? LIMIT 1")
    .get(previousPhotoUrl) as { id: number } | undefined
  if (stillReferenced) return

  try {
    await deleteUpload("people", filename)
  } catch (err) {
    if (err instanceof InvalidUploadFilenameError) return
    logger.warn(`Failed to delete superseded person photo ${filename}: ${String(err)}`)
  }
}
