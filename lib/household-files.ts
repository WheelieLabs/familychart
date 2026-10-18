// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { deleteUpload, listUploadMeta } from "@/lib/uploads/store"

const IMAGE_EXT = /\.(jpg|jpeg|png|webp|gif)$/i

export type HouseholdFileRow = {
  filename: string
  path: string
  url: string
  sizeBytes: number
  encrypted: boolean
  orphan: boolean
  personId: number | null
  personName: string | null
}

export type HouseholdFilesScan = {
  files: HouseholdFileRow[]
  totalBytes: number
  orphanCount: number
  orphanBytes: number
}

/**
 * On-demand scan of uploads/people against people.photo_url references.
 * Reports metadata only — never decrypts content.
 */
export async function scanHouseholdUploadFiles(db: Database.Database): Promise<HouseholdFilesScan> {
  const entries = await listUploadMeta("people")

  const owners = db
    .prepare(
      `SELECT id, name, photo_url FROM people WHERE photo_url IS NOT NULL AND photo_url != ''`,
    )
    .all() as { id: number; name: string; photo_url: string }[]

  const byUrl = new Map<string, { id: number; name: string }>()
  for (const row of owners) {
    if (!byUrl.has(row.photo_url)) {
      byUrl.set(row.photo_url, { id: row.id, name: row.name })
    }
  }

  const files: HouseholdFileRow[] = []
  let totalBytes = 0
  let orphanCount = 0
  let orphanBytes = 0

  for (const { filename, sizeBytes, encrypted } of entries) {
    if (!IMAGE_EXT.test(filename)) continue

    const url = `/api/uploads/${filename}`
    const owner = byUrl.get(url)
    const orphan = !owner
    if (orphan) {
      orphanCount++
      orphanBytes += sizeBytes
    }
    totalBytes += sizeBytes
    files.push({
      filename,
      path: `uploads/people/${filename}`,
      url,
      sizeBytes,
      encrypted,
      orphan,
      personId: owner?.id ?? null,
      personName: owner?.name ?? null,
    })
  }

  files.sort((a, b) => a.filename.localeCompare(b.filename))
  return { files, totalBytes, orphanCount, orphanBytes }
}

/** Delete orphan upload files only. Returns deleted filenames. */
export async function purgeOrphanUploadFiles(
  db: Database.Database,
  filenames: string[],
): Promise<{ deleted: string[]; skipped: string[] }> {
  const deleted: string[] = []
  const skipped: string[] = []

  for (const raw of filenames) {
    if (!IMAGE_EXT.test(raw) || raw.includes("/") || raw.includes("\\") || raw.includes("..")) {
      skipped.push(raw)
      continue
    }
    const filename = raw
    const url = `/api/uploads/${filename}`
    const referenced = db
      .prepare("SELECT id FROM people WHERE photo_url = ? LIMIT 1")
      .get(url) as { id: number } | undefined
    if (referenced) {
      skipped.push(filename)
      continue
    }
    try {
      const removed = await deleteUpload("people", filename)
      if (removed) deleted.push(filename)
      else skipped.push(filename)
    } catch {
      skipped.push(filename)
    }
  }

  return { deleted, skipped }
}

const ATTACHMENT_EXT = /\.(pdf|jpg|jpeg|png|webp)$/i
const ATTACHMENT_URL_PREFIX = "/api/test-results/uploads/"

export type AttachmentEventRef = {
  id: number
  personId: number
  personName: string
  name: string
  date: string
}

export type AttachmentFileRow = {
  filename: string
  url: string
  sizeBytes: number
  encrypted: boolean
  /** On disk but no test result references it. */
  orphan: boolean
  /** A test result references it but the file is not on disk. */
  missing: boolean
  events: AttachmentEventRef[]
}

export type AttachmentsScan = {
  files: AttachmentFileRow[]
  totalBytes: number
  orphanCount: number
  orphanBytes: number
  missingCount: number
  /** Space used per person, largest first. */
  byPerson: { personId: number; personName: string; fileCount: number; bytes: number }[]
}

/**
 * On-demand scan of uploads/test-results against test_events.attachment_url. Metadata only —
 * never decrypts content. A file shared by several events is counted once.
 */
export async function scanTestResultAttachments(db: Database.Database): Promise<AttachmentsScan> {
  const entries = (await listUploadMeta("test-results")).filter(e => ATTACHMENT_EXT.test(e.filename))
  const onDisk = new Map(entries.map(e => [e.filename, e]))

  const refs = db
    .prepare(
      `SELECT te.id, te.person_id AS personId, p.name AS personName, te.name, te.date, te.attachment_url AS url
         FROM test_events te JOIN people p ON p.id = te.person_id
        WHERE te.attachment_url LIKE ?
        ORDER BY te.date DESC, te.id DESC`,
    )
    .all(`${ATTACHMENT_URL_PREFIX}%`) as (AttachmentEventRef & { url: string })[]

  const byFile = new Map<string, AttachmentEventRef[]>()
  for (const { url, ...event } of refs) {
    const filename = url.slice(ATTACHMENT_URL_PREFIX.length)
    byFile.set(filename, [...(byFile.get(filename) ?? []), event])
  }

  const files: AttachmentFileRow[] = []
  for (const entry of entries) {
    const events = byFile.get(entry.filename) ?? []
    files.push({
      filename: entry.filename,
      url: `${ATTACHMENT_URL_PREFIX}${entry.filename}`,
      sizeBytes: entry.sizeBytes,
      encrypted: entry.encrypted,
      orphan: events.length === 0,
      missing: false,
      events,
    })
  }
  for (const [filename, events] of byFile) {
    if (onDisk.has(filename)) continue
    files.push({
      filename, url: `${ATTACHMENT_URL_PREFIX}${filename}`, sizeBytes: 0, encrypted: false,
      orphan: false, missing: true, events,
    })
  }
  files.sort((a, b) => b.sizeBytes - a.sizeBytes || a.filename.localeCompare(b.filename))

  const byPersonMap = new Map<number, { personId: number; personName: string; fileCount: number; bytes: number }>()
  for (const f of files) {
    // Attribute a shared file to its first (most recent) event's person so totals never double count.
    const owner = f.events[0]
    if (!owner) continue
    const row = byPersonMap.get(owner.personId) ?? { personId: owner.personId, personName: owner.personName, fileCount: 0, bytes: 0 }
    row.fileCount++
    row.bytes += f.sizeBytes
    byPersonMap.set(owner.personId, row)
  }

  const orphans = files.filter(f => f.orphan)
  return {
    files,
    totalBytes: files.reduce((sum, f) => sum + f.sizeBytes, 0),
    orphanCount: orphans.length,
    orphanBytes: orphans.reduce((sum, f) => sum + f.sizeBytes, 0),
    missingCount: files.filter(f => f.missing).length,
    byPerson: [...byPersonMap.values()].sort((a, b) => b.bytes - a.bytes || a.personName.localeCompare(b.personName)),
  }
}

/** Delete orphan attachment files only; a file any test result still references is never deleted. */
export async function purgeOrphanAttachmentFiles(
  db: Database.Database,
  filenames: string[],
): Promise<{ deleted: string[]; skipped: string[] }> {
  const deleted: string[] = []
  const skipped: string[] = []

  for (const filename of filenames) {
    if (!ATTACHMENT_EXT.test(filename) || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
      skipped.push(filename)
      continue
    }
    const referenced = db
      .prepare("SELECT id FROM test_events WHERE attachment_url = ? LIMIT 1")
      .get(`${ATTACHMENT_URL_PREFIX}${filename}`)
    if (referenced) {
      skipped.push(filename)
      continue
    }
    try {
      if (await deleteUpload("test-results", filename)) deleted.push(filename)
      else skipped.push(filename)
    } catch {
      skipped.push(filename)
    }
  }
  return { deleted, skipped }
}
