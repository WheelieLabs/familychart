// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"

/** Upload URLs minted by `POST /api/upload` — UUID filename + allowed image extension. */
const PERSON_PHOTO_URL_RE =
  /^\/api\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|gif)$/i

export function isValidPersonPhotoUploadUrl(url: string): boolean {
  return PERSON_PHOTO_URL_RE.test(url)
}

/**
 * Validates a `people.photo_url` write.
 * Allows `null` (clear). Non-null must be a well-formed `/api/uploads/{uuid}.{ext}`
 * URL and must not already be set on a different person (prevents duplicate-URL IDOR).
 */
export function validatePersonPhotoUrlWrite(
  db: Database.Database,
  photoUrl: string | null,
  personId: number,
): { ok: true; photoUrl: string | null } | { ok: false; error: string } {
  if (photoUrl == null) return { ok: true, photoUrl: null }
  const trimmed = photoUrl.trim()
  if (!trimmed) return { ok: true, photoUrl: null }
  if (!isValidPersonPhotoUploadUrl(trimmed)) {
    return { ok: false, error: "Invalid photo_url" }
  }
  const other = db
    .prepare("SELECT id FROM people WHERE photo_url = ? AND id != ? LIMIT 1")
    .get(trimmed, personId) as { id: number } | undefined
  if (other) {
    return { ok: false, error: "photo_url is already in use" }
  }
  return { ok: true, photoUrl: trimmed }
}
