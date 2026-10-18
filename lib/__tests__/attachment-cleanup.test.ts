import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const deleteUpload = vi.fn(async () => true)
vi.mock("@/lib/uploads/store", () => ({
  deleteUpload: (...args: unknown[]) => deleteUpload(...(args as Parameters<typeof deleteUpload>)),
}))

import { deleteAttachmentIfUnreferenced } from "@/lib/test-results/attachment-cleanup"
import { parseTestAttachmentUrl } from "@/lib/test-results/attachment-url"

const FILE = "77777777-7777-4777-8777-777777777777.pdf"
const URL_ = `/api/test-results/uploads/${FILE}`

let db: Database.Database

describe("deleteAttachmentIfUnreferenced", () => {
  beforeEach(() => {
    db = new Database(":memory:")
    db.exec("CREATE TABLE test_events (id INTEGER PRIMARY KEY, person_id INTEGER, attachment_url TEXT)")
    deleteUpload.mockClear()
  })
  afterEach(() => db.close())

  it("deletes an unreferenced canonical blob", async () => {
    await deleteAttachmentIfUnreferenced(db, URL_)
    expect(deleteUpload).toHaveBeenCalledWith("test-results", FILE)
  })

  it("keeps a blob still referenced by any event, including a path-variant row", async () => {
    db.prepare("INSERT INTO test_events (person_id, attachment_url) VALUES (2, ?)").run(`x/${FILE}`)
    await deleteAttachmentIfUnreferenced(db, URL_)
    expect(deleteUpload).not.toHaveBeenCalled()
  })

  it("never deletes from a non-canonical URL", async () => {
    await deleteAttachmentIfUnreferenced(db, `x/${FILE}`)
    await deleteAttachmentIfUnreferenced(db, "/api/test-results/uploads/abc.pdf")
    await deleteAttachmentIfUnreferenced(db, null)
    expect(deleteUpload).not.toHaveBeenCalled()
  })
})

describe("parseTestAttachmentUrl", () => {
  it("returns the filename for canonical URLs only", () => {
    expect(parseTestAttachmentUrl(URL_)).toBe(FILE)
    expect(parseTestAttachmentUrl(`x/${FILE}`)).toBeNull()
    expect(parseTestAttachmentUrl(null)).toBeNull()
  })
})
