import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const canReadForPerson = vi.fn()

vi.mock("@/lib/auth/auth-helpers", () => ({
  requireAuth: vi.fn(async () => ({
    session: { user: { email: "demo@test" } },
    groups: ["local:write"],
  })),
}))

vi.mock("@/lib/permissions", () => ({
  canReadForPerson: (...args: unknown[]) => canReadForPerson(...(args as Parameters<typeof canReadForPerson>)),
}))

vi.mock("@/lib/uploads/store", () => ({
  readUpload: vi.fn(async () => Buffer.from("pdf-bytes")),
  InvalidUploadFilenameError: class InvalidUploadFilenameError extends Error {},
}))

let testDb: Database.Database

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
}))

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE people (id INTEGER PRIMARY KEY, account_uid TEXT);
    CREATE TABLE test_events (id INTEGER PRIMARY KEY, person_id INTEGER, attachment_url TEXT);
  `)
  return db
}

function params(filename: string) {
  return { params: Promise.resolve({ filename }) }
}

describe("GET /api/test-results/uploads/[filename]", () => {
  beforeEach(() => {
    testDb = createTestDb()
    vi.resetModules()
    canReadForPerson.mockReset()
  })

  afterEach(() => {
    testDb?.close()
  })

  it("404s when no test_events row references the filename", async () => {
    const { GET } = await import("@/app/api/test-results/uploads/[filename]/route")
    const res = await GET(new NextRequest("http://localhost/api/test-results/uploads/orphan.pdf"), params("orphan.pdf"))
    expect(res.status).toBe(404)
    expect(canReadForPerson).not.toHaveBeenCalled()
  })

  it("404s when the caller cannot read the owning person", async () => {
    testDb.exec(`
      INSERT INTO people (id, account_uid) VALUES (1, 'uid-1');
      INSERT INTO test_events (id, person_id, attachment_url) VALUES (1, 1, '/api/test-results/uploads/abc.pdf');
    `)
    canReadForPerson.mockReturnValue(false)
    const { GET } = await import("@/app/api/test-results/uploads/[filename]/route")
    const res = await GET(new NextRequest("http://localhost/api/test-results/uploads/abc.pdf"), params("abc.pdf"))
    expect(res.status).toBe(404)
  })

  it("serves the PDF when the caller can read the owning person", async () => {
    testDb.exec(`
      INSERT INTO people (id, account_uid) VALUES (1, 'uid-1');
      INSERT INTO test_events (id, person_id, attachment_url) VALUES (1, 1, '/api/test-results/uploads/abc.pdf');
    `)
    canReadForPerson.mockReturnValue(true)
    const { GET } = await import("@/app/api/test-results/uploads/[filename]/route")
    const res = await GET(new NextRequest("http://localhost/api/test-results/uploads/abc.pdf"), params("abc.pdf"))
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/pdf")
  })

  it("400s for an unsupported extension", async () => {
    const { GET } = await import("@/app/api/test-results/uploads/[filename]/route")
    const res = await GET(new NextRequest("http://localhost/api/test-results/uploads/abc.exe"), params("abc.exe"))
    expect(res.status).toBe(400)
  })
})
