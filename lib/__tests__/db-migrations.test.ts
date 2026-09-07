// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest"
import Database from "better-sqlite3-multiple-ciphers"
import { MIGRATIONS, runMigrations } from "@/lib/db-migrations"
import { applyBaselineSchema } from "@/lib/db"

describe("schema migrations (1.0.0 baseline squash)", () => {
  it("has no migrations before the next post-1.0.0 schema change", () => {
    expect(MIGRATIONS).toEqual([])
  })

  it("a fresh database does not depend on any migration to become usable", () => {
    const db = new Database(":memory:")
    applyBaselineSchema(db)
    expect(() => runMigrations(db)).not.toThrow()
    expect(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'accounts'").get(),
    ).toBeTruthy()
    db.close()
  })

  it("is idempotent across repeated runs", () => {
    const db = new Database(":memory:")
    applyBaselineSchema(db)
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()
    db.close()
  })
})

describe("applyBaselineSchema", () => {
  it("creates the live 1.0.0 schema — accounts and people.account_uid, not local_users", () => {
    const db = new Database(":memory:")
    applyBaselineSchema(db)

    expect(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'accounts'").get(),
    ).toBeTruthy()
    expect(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'local_users'").get(),
    ).toBeUndefined()

    const columns = (db.prepare("PRAGMA table_info(people)").all() as { name: string }[]).map(
      c => c.name,
    )
    expect(columns).toContain("account_uid")
    expect(columns).not.toContain("user_uid")

    const index = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get("idx_people_account_uid_unique")
    expect(index).toBeTruthy()

    db.close()
  })

  it("accounts carries the full live column set from the start", () => {
    const db = new Database(":memory:")
    applyBaselineSchema(db)
    const columns = (db.prepare("PRAGMA table_info(accounts)").all() as { name: string }[]).map(
      c => c.name,
    )
    for (const col of [
      "auth_method",
      "external_id",
      "status",
      "invite_token_hash",
      "invite_expires_at",
      "invite_revoked_at",
      "must_reset_password",
    ]) {
      expect(columns).toContain(col)
    }
    db.close()
  })

  it("enforces uniqueness on people.account_uid", () => {
    const db = new Database(":memory:")
    applyBaselineSchema(db)
    db.prepare("INSERT INTO people (name, account_uid) VALUES ('Ben', 'local:1')").run()
    db.prepare("INSERT INTO people (name, account_uid) VALUES ('Other', 'local:2')").run()
    expect(() =>
      db.prepare("UPDATE people SET account_uid = 'local:1' WHERE name = 'Other'").run(),
    ).toThrow(/SQLITE_CONSTRAINT_UNIQUE|UNIQUE constraint failed/)
    db.close()
  })

  it("is safe to apply twice on the same database (second getDb() open in one process)", () => {
    const db = new Database(":memory:")
    applyBaselineSchema(db)
    db.prepare(
      "INSERT INTO accounts (email, password_hash, role) VALUES ('a@example.com', 'h', 'admin')",
    ).run()
    db.prepare("INSERT INTO people (name, account_uid) VALUES ('Ben', 'local:1')").run()

    expect(() => applyBaselineSchema(db)).not.toThrow()

    expect((db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n).toBe(1)
    expect((db.prepare("SELECT COUNT(*) AS n FROM people").get() as { n: number }).n).toBe(1)
    db.close()
  })
})
