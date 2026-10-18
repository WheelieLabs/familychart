import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, describe, expect, it, vi } from "vitest"
import { purgeOrphanAttachmentFiles, scanTestResultAttachments } from "@/lib/household-files"
import { deleteUpload, listUploadMeta } from "@/lib/uploads/store"

vi.mock("@/lib/uploads/store", () => ({
  deleteUpload: vi.fn(),
  listUploadMeta: vi.fn(),
}))

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE people (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, photo_url TEXT);
    CREATE TABLE test_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, person_id INTEGER NOT NULL, name TEXT NOT NULL,
      date TEXT NOT NULL, attachment_url TEXT
    );
    INSERT INTO people (name) VALUES ('Alice'), ('Bob');
  `)
  return db
}

const url = (f: string) => `/api/test-results/uploads/${f}`

describe("scanTestResultAttachments", () => {
  afterEach(() => vi.clearAllMocks())

  it("lists referenced files with their events, sizes and per-person totals", async () => {
    const db = createTestDb()
    db.prepare("INSERT INTO test_events (person_id, name, date, attachment_url) VALUES (1, 'FBC', '2026-08-01T02:30:00.000Z', ?)").run(url("a.pdf"))
    db.prepare("INSERT INTO test_events (person_id, name, date, attachment_url) VALUES (1, 'Iron', '2026-08-02T02:30:00.000Z', ?)").run(url("b.png"))
    db.prepare("INSERT INTO test_events (person_id, name, date, attachment_url) VALUES (2, 'TFT', '2026-08-03T02:30:00.000Z', ?)").run(url("c.pdf"))
    vi.mocked(listUploadMeta).mockResolvedValue([
      { filename: "a.pdf", sizeBytes: 1000, encrypted: true },
      { filename: "b.png", sizeBytes: 500, encrypted: true },
      { filename: "c.pdf", sizeBytes: 2000, encrypted: false },
    ])

    const scan = await scanTestResultAttachments(db)

    expect(scan.totalBytes).toBe(3500)
    expect(scan.orphanCount).toBe(0)
    expect(scan.files.find(f => f.filename === "a.pdf")).toMatchObject({
      url: url("a.pdf"), sizeBytes: 1000, encrypted: true, orphan: false, missing: false,
      events: [{ id: 1, personId: 1, personName: "Alice", name: "FBC" }],
    })
    expect(scan.byPerson).toEqual([
      { personId: 2, personName: "Bob", fileCount: 1, bytes: 2000 },
      { personId: 1, personName: "Alice", fileCount: 2, bytes: 1500 },
    ])
  })

  it("flags files no test result references as orphans", async () => {
    const db = createTestDb()
    vi.mocked(listUploadMeta).mockResolvedValue([{ filename: "stray.pdf", sizeBytes: 700, encrypted: true }])

    const scan = await scanTestResultAttachments(db)

    expect(scan.files).toMatchObject([{ filename: "stray.pdf", orphan: true, events: [] }])
    expect(scan.orphanCount).toBe(1)
    expect(scan.orphanBytes).toBe(700)
  })

  it("reports a referenced file that is missing on disk", async () => {
    const db = createTestDb()
    db.prepare("INSERT INTO test_events (person_id, name, date, attachment_url) VALUES (1, 'FBC', '2026-08-01T02:30:00.000Z', ?)").run(url("gone.pdf"))
    vi.mocked(listUploadMeta).mockResolvedValue([])

    const scan = await scanTestResultAttachments(db)

    expect(scan.missingCount).toBe(1)
    expect(scan.files).toMatchObject([{ filename: "gone.pdf", missing: true, sizeBytes: 0, orphan: false }])
    expect(scan.totalBytes).toBe(0)
  })

  it("counts a file shared by two events once", async () => {
    const db = createTestDb()
    for (const id of [1, 2]) {
      db.prepare("INSERT INTO test_events (person_id, name, date, attachment_url) VALUES (?, 'FBC', '2026-08-01T02:30:00.000Z', ?)").run(id, url("shared.pdf"))
    }
    vi.mocked(listUploadMeta).mockResolvedValue([{ filename: "shared.pdf", sizeBytes: 100, encrypted: true }])

    const scan = await scanTestResultAttachments(db)

    expect(scan.files).toHaveLength(1)
    expect(scan.files[0]!.events).toHaveLength(2)
    expect(scan.totalBytes).toBe(100)
  })

  it("ignores unsupported file types in the bucket", async () => {
    const db = createTestDb()
    vi.mocked(listUploadMeta).mockResolvedValue([{ filename: "notes.txt", sizeBytes: 5, encrypted: false }])
    expect((await scanTestResultAttachments(db)).files).toEqual([])
  })
})

describe("purgeOrphanAttachmentFiles", () => {
  afterEach(() => vi.clearAllMocks())

  it("deletes an unreferenced file from the test-results bucket", async () => {
    const db = createTestDb()
    vi.mocked(deleteUpload).mockResolvedValue(true)
    const result = await purgeOrphanAttachmentFiles(db, ["stray.pdf"])
    expect(result).toEqual({ deleted: ["stray.pdf"], skipped: [] })
    expect(deleteUpload).toHaveBeenCalledWith("test-results", "stray.pdf")
  })

  it("never deletes a file a test result still references", async () => {
    const db = createTestDb()
    db.prepare("INSERT INTO test_events (person_id, name, date, attachment_url) VALUES (1, 'FBC', '2026-08-01T02:30:00.000Z', ?)").run(url("kept.pdf"))
    const result = await purgeOrphanAttachmentFiles(db, ["kept.pdf"])
    expect(result).toEqual({ deleted: [], skipped: ["kept.pdf"] })
    expect(deleteUpload).not.toHaveBeenCalled()
  })

  it.each(["../x.pdf", "a/b.pdf", "a\\b.pdf", "x.txt", "noext"])("rejects unsafe name %s", async raw => {
    const result = await purgeOrphanAttachmentFiles(createTestDb(), [raw])
    expect(result).toEqual({ deleted: [], skipped: [raw] })
    expect(deleteUpload).not.toHaveBeenCalled()
  })
})
