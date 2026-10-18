// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"

/** Upload URLs minted by `POST /api/test-results/upload`: UUID filename plus an allowed extension. */
const TEST_ATTACHMENT_URL_RE =
  /^\/api\/test-results\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:pdf|jpg|jpeg|png|webp))$/i

/**
 * The stored blob filename for a canonical test-result attachment URL, or null for anything else
 * (legacy or hand-written values included). Never derive a filename from a non-canonical URL.
 */
export function parseTestAttachmentUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const match = TEST_ATTACHMENT_URL_RE.exec(url)
  return match ? match[1] : null
}

/**
 * Validates a `test_events.attachment_url` write. Blank or null clears it. A non-blank value must
 * be a canonical upload URL and must not already be referenced by a different Person's event.
 */
export function validateTestAttachmentUrlWrite(
  db: Database.Database,
  raw: unknown,
  personId: number,
): { ok: true; attachmentUrl: string | null } | { ok: false; error: string } {
  if (raw == null) return { ok: true, attachmentUrl: null }
  if (typeof raw !== "string") return { ok: false, error: "Invalid attachment_url" }
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, attachmentUrl: null }
  const filename = parseTestAttachmentUrl(trimmed)
  if (!filename) return { ok: false, error: "Invalid attachment_url" }
  const other = db
    .prepare("SELECT 1 FROM test_events WHERE person_id != ? AND attachment_url LIKE '%/' || ? LIMIT 1")
    .get(personId, filename)
  if (other) return { ok: false, error: "attachment_url is already in use" }
  return { ok: true, attachmentUrl: trimmed }
}
