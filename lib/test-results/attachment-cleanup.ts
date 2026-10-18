// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { deleteUpload } from "@/lib/uploads/store"
import { parseTestAttachmentUrl } from "@/lib/test-results/attachment-url"

/**
 * Deletes a test result's attachment blob once nothing references it any more. Call after the row
 * change is committed. A file another test result still points at is kept, and a blob that is
 * already gone or unreadable never fails the request (the database row is the source of truth).
 */
export async function deleteAttachmentIfUnreferenced(
  db: Database.Database,
  attachmentUrl: string | null,
): Promise<void> {
  // Only a canonical upload URL ever names a blob; legacy or odd values never delete anything.
  const filename = parseTestAttachmentUrl(attachmentUrl)
  if (!filename) return
  // Match by canonical filename so a path-variant row still counts as a reference.
  const stillReferenced = db
    .prepare("SELECT 1 FROM test_events WHERE attachment_url LIKE '%/' || ? LIMIT 1")
    .get(filename)
  if (stillReferenced) return
  try {
    await deleteUpload("test-results", filename)
  } catch {
    // Blob already gone / invalid filename.
  }
}
