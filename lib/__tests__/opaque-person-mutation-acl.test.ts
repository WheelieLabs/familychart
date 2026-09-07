import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))

import { authorisePersonAccess, type AuthedContext } from "@/lib/auth/auth-helpers"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE people (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#000',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      account_uid TEXT,
      date_of_birth TEXT,
      full_name TEXT,
      photo_url TEXT
    );
    INSERT INTO people (id, name, account_uid) VALUES (1, 'Pat', 'owner-1');
  `)
  return db
}

function ctx(groups: string[], id = "local:99"): AuthedContext {
  return {
    session: { user: { email: "u@test", id, groups } } as AuthedContext["session"],
    groups,
  }
}

describe("authorisePersonAccess opaque denial", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it("returns 404 (not 403) when the session cannot write the person", () => {
    const result = authorisePersonAccess(db, ctx(["local:read"]), 1, "write")
    expect(result).toBeInstanceOf(NextResponse)
    const res = result as NextResponse
    expect(res.status).toBe(404)
  })

  it("returns 404 for a missing person id", () => {
    const result = authorisePersonAccess(db, ctx(["local:write"]), 99, "write")
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(404)
  })

  it("returns the person when write is allowed", () => {
    const result = authorisePersonAccess(db, ctx(["local:write"]), 1, "write")
    expect(result).not.toBeInstanceOf(NextResponse)
    expect((result as { id: number }).id).toBe(1)
  })
})
