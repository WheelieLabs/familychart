import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  bumpLocalUserSessionVersion,
  localRoleToGroups,
  refreshLocalUserSession,
} from "@/lib/local-user-session"

function createDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY,
      role TEXT NOT NULL,
      can_report INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      session_version INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO accounts (id, role, can_report, is_active, session_version)
    VALUES (1, 'admin', 1, 1, 0);
  `)
  return db
}

describe("local-user-session", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createDb()
  })

  afterEach(() => {
    db.close()
  })

  it("maps roles to groups", () => {
    expect(localRoleToGroups("admin", 1)).toEqual(["local:admin", "local:report"])
  })

  it("refreshes active session groups", () => {
    const refreshed = refreshLocalUserSession(db, 1, 0)
    expect(refreshed?.groups).toEqual(["local:admin", "local:report"])
  })

  it("revokes inactive users", () => {
    db.prepare("UPDATE accounts SET is_active = 0 WHERE id = 1").run()
    expect(refreshLocalUserSession(db, 1, 0)).toBeNull()
  })

  it("revokes stale session_version", () => {
    bumpLocalUserSessionVersion(db, 1)
    expect(refreshLocalUserSession(db, 1, 0)).toBeNull()
  })
})
