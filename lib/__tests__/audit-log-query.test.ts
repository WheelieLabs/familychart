// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  listAuditLogFacets,
  parseAuditLogQuery,
  queryAuditLog,
} from "@/lib/audit-log-query"

function makeDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email  TEXT,
      action      TEXT    NOT NULL,
      entity_type TEXT    NOT NULL,
      entity_id   INTEGER,
      details     TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
  return db
}

describe("parseAuditLogQuery", () => {
  it("applies defaults", () => {
    const q = parseAuditLogQuery(new URLSearchParams())
    expect(q).toEqual({
      actor: undefined,
      action: undefined,
      entityType: undefined,
      from: undefined,
      to: undefined,
      limit: 50,
      offset: 0,
    })
  })

  it("rejects invalid limit", () => {
    expect(parseAuditLogQuery(new URLSearchParams("limit=0"))).toEqual({ error: "Invalid limit" })
    expect(parseAuditLogQuery(new URLSearchParams("limit=101"))).toEqual({ error: "Invalid limit" })
  })
})

describe("queryAuditLog", () => {
  let db: Database.Database

  beforeEach(() => {
    db = makeDb()
    db.prepare(
      `INSERT INTO audit_log (user_email, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("admin@example.com", "CREATE", "local_users", 1, "{}", "2026-07-01T10:00:00")
    db.prepare(
      `INSERT INTO audit_log (user_email, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("carer@example.com", "UPDATE", "people", 2, "{}", "2026-07-10T12:00:00")
  })

  afterEach(() => {
    db.close()
  })

  it("filters by actor and action", () => {
    const page = queryAuditLog(db, {
      actor: "admin",
      action: "CREATE",
      limit: 50,
      offset: 0,
    })
    expect(page.total).toBe(1)
    expect(page.rows[0]?.entity_type).toBe("local_users")
  })

  it("returns facets", () => {
    const facets = listAuditLogFacets(db)
    expect(facets.actions).toEqual(["CREATE", "UPDATE"])
    expect(facets.entityTypes).toEqual(["local_users", "people"])
  })
})
