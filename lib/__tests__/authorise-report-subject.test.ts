// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}))

import { authoriseReportSubject, type AuthedContext } from "@/lib/auth/auth-helpers"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE people (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      account_uid TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO people (id, name, account_uid) VALUES (1, 'Self', 'local:2');
    INSERT INTO people (id, name, account_uid) VALUES (2, 'Other', NULL);
  `)
  return db
}

function ctx(id: string, groups: string[]): AuthedContext {
  return {
    groups,
    session: {
      user: { id, email: `${id}@example.com`, name: "Tester", groups },
      expires: "2099-01-01",
    },
  }
}

describe("authoriseReportSubject", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it("lets a Household Reports carer generate for any Person they can read", () => {
    const person = authoriseReportSubject(db, ctx("local:9", ["local:write", "local:report"]), 2)
    expect(person).toMatchObject({ id: 2, name: "Other" })
  })

  it("lets a None Account generate a report of their Personal-linked Person without Household Reports", () => {
    const person = authoriseReportSubject(db, ctx("local:2", []), 1)
    expect(person).toMatchObject({ id: 1, name: "Self" })
  })

  it("denies a Personal-linked Account a report of someone else", () => {
    const result = authoriseReportSubject(db, ctx("local:2", []), 2)
    expect(result).toMatchObject({ status: 404 })
  })

  it("denies a session that has neither Household Reports nor a Personal-link", () => {
    const result = authoriseReportSubject(db, ctx("local:9", ["local:read"]), 2)
    expect(result).toMatchObject({ status: 404 })
  })
})
