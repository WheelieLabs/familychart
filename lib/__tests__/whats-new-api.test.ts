import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"

const changelogFixture = {
  entries: [
    { version: "0.36.0", date: "2026-06-10", highlights: ["A"] },
    { version: "0.37.0", date: "2026-06-20", highlights: ["B"] },
  ],
}

vi.mock("@/lib/changelog.generated.json", () => ({ default: changelogFixture }))
vi.mock("@/lib/version", () => ({ APP_VERSION: "0.37.0" }))
vi.mock("@/lib/auth/auth-helpers", () => ({
  requireRead: vi.fn(async () => ({ session: { user: { email: "u@test" } } })),
}))
vi.mock("@/lib/account/account-identity", () => ({
  canonicalAccountUid: vi.fn(() => "uid-test"),
}))

let testDb: Database.Database

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
}))

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE user_app_state (
      user_uid TEXT PRIMARY KEY,
      last_seen_version TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  return db
}

describe("/api/whats-new", () => {
  beforeEach(() => {
    testDb = createTestDb()
    vi.resetModules()
  })

  afterEach(() => {
    testDb?.close()
  })

  it("seeds last_seen_version and returns empty entries on first visit", async () => {
    const { GET } = await import("@/app/api/whats-new/route")
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ entries: [] })

    const row = testDb
      .prepare("SELECT last_seen_version FROM user_app_state WHERE user_uid = ?")
      .get("uid-test") as { last_seen_version: string }
    expect(row.last_seen_version).toBe("0.37.0")
  })

  it("returns unseen entries between last_seen and APP_VERSION", async () => {
    testDb
      .prepare(
        `INSERT INTO user_app_state (user_uid, last_seen_version, updated_at)
         VALUES ('uid-test', '0.36.0', datetime('now'))`
      )
      .run()

    const { GET } = await import("@/app/api/whats-new/route")
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      entries: [changelogFixture.entries[1]],
    })
  })
})

describe("/api/whats-new/seen", () => {
  beforeEach(() => {
    testDb = createTestDb()
    vi.resetModules()
  })

  afterEach(() => {
    testDb?.close()
  })

  it("sets last_seen_version to APP_VERSION", async () => {
    const { POST } = await import("@/app/api/whats-new/seen/route")
    const res = await POST()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })

    const row = testDb
      .prepare("SELECT last_seen_version FROM user_app_state WHERE user_uid = ?")
      .get("uid-test") as { last_seen_version: string }
    expect(row.last_seen_version).toBe("0.37.0")
  })
})

describe("auth guard", () => {
  beforeEach(() => {
    testDb = createTestDb()
    vi.resetModules()
  })

  afterEach(() => {
    testDb?.close()
  })

  it("returns unauthorised when account uid is missing", async () => {
    const identity = await import("@/lib/account/account-identity")
    vi.mocked(identity.canonicalAccountUid).mockReturnValueOnce(null)

    const { GET } = await import("@/app/api/whats-new/route")
    const res = await GET()
    expect(res.status).toBe(401)
    expect(res).toBeInstanceOf(NextResponse)
  })
})
