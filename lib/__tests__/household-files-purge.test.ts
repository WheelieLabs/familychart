// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, describe, expect, it, vi } from "vitest"
import { purgeOrphanUploadFiles } from "@/lib/household-files"
import { deleteUpload } from "@/lib/uploads/store"

vi.mock("@/lib/uploads/store", () => ({
  deleteUpload: vi.fn(),
}))

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE people (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      photo_url  TEXT
    );
  `)
  return db
}

describe("purgeOrphanUploadFiles", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("deletes a file that is not referenced by any person", async () => {
    const db = createTestDb()
    vi.mocked(deleteUpload).mockResolvedValue(true)

    const result = await purgeOrphanUploadFiles(db, ["orphan.jpg"])

    expect(result).toEqual({ deleted: ["orphan.jpg"], skipped: [] })
    expect(deleteUpload).toHaveBeenCalledWith("people", "orphan.jpg")
  })

  it("skips a file that is still referenced by a person's photo_url (reference-count guard)", async () => {
    const db = createTestDb()
    db.prepare("INSERT INTO people (name, photo_url) VALUES (?, ?)").run(
      "Alice",
      "/api/uploads/in-use.jpg",
    )

    const result = await purgeOrphanUploadFiles(db, ["in-use.jpg"])

    expect(result).toEqual({ deleted: [], skipped: ["in-use.jpg"] })
    expect(deleteUpload).not.toHaveBeenCalled()
  })

  it.each([
    ["../../etc/passwd.jpg", "parent traversal"],
    ["sub/dir.jpg", "forward slash"],
    ["sub\\dir.jpg", "backslash"],
    ["..jpg", "double-dot in filename"],
    ["not-an-image.txt", "disallowed extension"],
    ["no-extension", "missing extension"],
  ])("rejects unsafe filename %s (%s) without touching the filesystem", async (raw) => {
    const db = createTestDb()

    const result = await purgeOrphanUploadFiles(db, [raw])

    expect(result).toEqual({ deleted: [], skipped: [raw] })
    expect(deleteUpload).not.toHaveBeenCalled()
  })

  it("accepts image filenames across the allowed extensions", async () => {
    const db = createTestDb()
    vi.mocked(deleteUpload).mockResolvedValue(true)

    const result = await purgeOrphanUploadFiles(db, ["a.jpg", "b.jpeg", "c.png", "d.webp", "e.gif"])

    expect(result.deleted).toEqual(["a.jpg", "b.jpeg", "c.png", "d.webp", "e.gif"])
    expect(result.skipped).toEqual([])
  })

  it("skips a file when the underlying delete reports it did not remove anything", async () => {
    const db = createTestDb()
    vi.mocked(deleteUpload).mockResolvedValue(false)

    const result = await purgeOrphanUploadFiles(db, ["missing.jpg"])

    expect(result).toEqual({ deleted: [], skipped: ["missing.jpg"] })
  })

  it("catches a delete failure and skips the file rather than throwing", async () => {
    const db = createTestDb()
    vi.mocked(deleteUpload).mockRejectedValue(new Error("disk error"))

    const result = await purgeOrphanUploadFiles(db, ["errors.jpg"])

    expect(result).toEqual({ deleted: [], skipped: ["errors.jpg"] })
  })

  it("processes a mixed batch independently, isolating one file's failure from the rest", async () => {
    const db = createTestDb()
    db.prepare("INSERT INTO people (name, photo_url) VALUES (?, ?)").run(
      "Alice",
      "/api/uploads/referenced.jpg",
    )
    vi.mocked(deleteUpload).mockImplementation(async (_bucket, filename) => {
      if (filename === "fails.jpg") throw new Error("disk error")
      return true
    })

    const result = await purgeOrphanUploadFiles(db, [
      "referenced.jpg",
      "fails.jpg",
      "ok.jpg",
      "../traversal.jpg",
    ])

    expect(result.deleted).toEqual(["ok.jpg"])
    expect(result.skipped).toEqual(
      expect.arrayContaining(["referenced.jpg", "fails.jpg", "../traversal.jpg"]),
    )
  })
})
