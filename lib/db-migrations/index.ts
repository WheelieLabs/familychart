// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { logger } from "@/lib/logger"

export interface Migration {
  id: string
  up: (db: Database.Database) => void
}

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          TEXT PRIMARY KEY,
      applied_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

function isApplied(db: Database.Database, id: string): boolean {
  const row = db.prepare("SELECT 1 FROM schema_migrations WHERE id = ?").get(id)
  return Boolean(row)
}

function markApplied(db: Database.Database, id: string): void {
  db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(id)
}

/**
 * v1.0.0 baseline: migrations 001–015 (the original v1 squash) plus 016 and 017 (the local_users
 * → Accounts unification) are all folded into `applyBaselineSchema()` in `lib/db.ts` — every
 * install past this point creates `accounts` and `people.account_uid` directly, never
 * `local_users` / `people.user_uid`. A database that already recorded 016/017 in
 * `schema_migrations` keeps those rows (harmless — they're just no longer in this list).
 * The runner stays live — add new migrations here for schema changes after 1.0.0.
 */
export const MIGRATIONS: Migration[] = []

export function runMigrations(db: Database.Database): void {
  ensureMigrationsTable(db)
  let applied = 0
  for (const migration of MIGRATIONS) {
    if (isApplied(db, migration.id)) continue
    try {
      migration.up(db)
      markApplied(db, migration.id)
      applied++
      logger.info("migration_applied", { id: migration.id })
    } catch (err) {
      logger.error("migration_failed", {
        id: migration.id,
        err: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }
  if (applied > 0) {
    logger.info("migrations_complete", { applied })
  }
}
