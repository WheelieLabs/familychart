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
