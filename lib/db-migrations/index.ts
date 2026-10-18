// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { logger } from "@/lib/logger"
import { syncTestMetricCatalogue } from "@/lib/test-results/test-metric-catalogue"

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

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return columns.some(c => c.name === column)
}

/**
 * v1.0.0 baseline: migrations 001–015 (the original v1 squash) plus 016 and 017 (the local_users
 * → Accounts unification) are all folded into `applyBaselineSchema()` in `lib/db.ts` — every
 * install past this point creates `accounts` and `people.account_uid` directly, never
 * `local_users` / `people.user_uid`. A database that already recorded 016/017 in
 * `schema_migrations` keeps those rows (harmless — they're just no longer in this list).
 * The runner stays live — add new migrations here for schema changes after 1.0.0.
 */
export const MIGRATIONS: Migration[] = [
  {
    // "administered by" on each dose record — added to `applyBaselineSchema()` for fresh
    // installs too, so this guards the column's presence rather than assuming it's missing
    // (SQLite has no `ADD COLUMN IF NOT EXISTS`).
    id: "018_medication_records_administered_by",
    up: db => {
      if (!hasColumn(db, "medication_records", "administered_by")) {
        db.exec("ALTER TABLE medication_records ADD COLUMN administered_by TEXT")
      }
    },
  },
  {
    // test_events/test_result_values/test_metric_config — also added to `applyBaselineSchema()`
    // for fresh installs. Unlike 018's ALTER TABLE, `CREATE TABLE`/`CREATE INDEX IF NOT EXISTS`
    // is naturally idempotent, so this needs no existence guard beyond that.
    id: "019_test_results",
    up: db => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS test_metric_config (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          metric_name TEXT    NOT NULL UNIQUE COLLATE NOCASE,
          unit        TEXT,
          sort_order  INTEGER NOT NULL DEFAULT 0,
          is_active   INTEGER NOT NULL DEFAULT 1,
          created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS test_events (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          person_id      INTEGER NOT NULL REFERENCES people(id),
          test_type      TEXT    NOT NULL,
          name           TEXT    NOT NULL,
          date           TEXT    NOT NULL,
          ordered_by     TEXT,
          notes          TEXT,
          attachment_url TEXT,
          created_by     TEXT,
          created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS test_result_values (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          test_event_id     INTEGER NOT NULL REFERENCES test_events(id) ON DELETE CASCADE,
          metric_name       TEXT    NOT NULL,
          value_type        TEXT    NOT NULL,
          numeric_value     REAL,
          qualitative_value TEXT,
          unit              TEXT,
          reference_range   TEXT,
          flag              TEXT,
          CHECK (
            (value_type = 'numeric'     AND numeric_value     IS NOT NULL AND qualitative_value IS NULL)
            OR
            (value_type = 'qualitative' AND qualitative_value IS NOT NULL AND numeric_value     IS NULL)
          )
        );
        CREATE INDEX IF NOT EXISTS idx_test_events_person ON test_events(person_id);
        CREATE INDEX IF NOT EXISTS idx_test_events_date   ON test_events(date);
        CREATE INDEX IF NOT EXISTS idx_test_result_values_event ON test_result_values(test_event_id);
      `)
    },
  },
  {
    // symptom_events — also added to `applyBaselineSchema()` for fresh installs. `CREATE TABLE`/
    // `CREATE INDEX IF NOT EXISTS` is naturally idempotent, so this needs no existence guard.
    id: "020_symptom_events",
    up: db => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS symptom_events (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          person_id    INTEGER NOT NULL REFERENCES people(id),
          label        TEXT    NOT NULL,
          start_date   TEXT    NOT NULL,
          end_date     TEXT,
          severity     INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 5),
          is_resolved  INTEGER NOT NULL DEFAULT 0,
          resolved_at  DATETIME,
          created_by   TEXT,
          created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_symptom_events_person      ON symptom_events(person_id);
        CREATE INDEX IF NOT EXISTS idx_symptom_events_date        ON symptom_events(start_date);
        CREATE INDEX IF NOT EXISTS idx_symptom_events_person_date ON symptom_events(person_id, start_date DESC);
      `)
    },
  },
  {
    // dose_expectations (+ exceptions, outcomes) — also added to `applyBaselineSchema()` for
    // fresh installs. `CREATE TABLE`/`CREATE INDEX IF NOT EXISTS` is naturally idempotent.
    id: "021_dose_expectations",
    up: db => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS dose_expectations (
          id                    INTEGER PRIMARY KEY AUTOINCREMENT,
          person_medication_id  INTEGER NOT NULL REFERENCES person_medications(id) ON DELETE CASCADE,
          slot_hhmm             TEXT    NOT NULL,
          start_date            TEXT    NOT NULL,
          end_date              TEXT    NOT NULL,
          weekdays              TEXT,
          created_by            TEXT,
          created_at            DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_dose_expectations_pm ON dose_expectations(person_medication_id);

        CREATE TABLE IF NOT EXISTS dose_expectation_exceptions (
          id                   INTEGER PRIMARY KEY AUTOINCREMENT,
          dose_expectation_id  INTEGER NOT NULL REFERENCES dose_expectations(id) ON DELETE CASCADE,
          local_ymd            TEXT    NOT NULL,
          UNIQUE(dose_expectation_id, local_ymd)
        );

        CREATE TABLE IF NOT EXISTS dose_expectation_outcomes (
          id                    INTEGER PRIMARY KEY AUTOINCREMENT,
          dose_expectation_id   INTEGER NOT NULL REFERENCES dose_expectations(id) ON DELETE CASCADE,
          local_ymd             TEXT    NOT NULL,
          status                TEXT    NOT NULL CHECK (status IN ('confirmed_given', 'confirmed_missed', 'snoozed')),
          snoozed_until         DATETIME,
          medication_record_id  INTEGER REFERENCES medication_records(id) ON DELETE SET NULL,
          resolved_by           TEXT,
          resolved_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(dose_expectation_id, local_ymd)
        );
      `)
    },
  },
  {
    // Outcomes remember the dose time they answer, so a confirmed miss can sit on the right
    // day/time in History. Older rows stay NULL and fall back to `resolved_at`. Also in
    // `applyBaselineSchema()`, so guard against the column already existing.
    id: "022_dose_expectation_outcome_slot_at",
    up: db => {
      const cols = db.prepare("PRAGMA table_info(dose_expectation_outcomes)").all() as { name: string }[]
      if (!cols.some(c => c.name === "slot_at")) {
        db.exec("ALTER TABLE dose_expectation_outcomes ADD COLUMN slot_at DATETIME")
      }
    },
  },
  {
    // Test-metric catalogue growth (ADR-0019): aliases, panel and value type per metric, plus a
    // nullable limit qualifier on result values; then refreshes the curated catalogue rows. Also
    // in `applyBaselineSchema()`, so each ALTER is guarded.
    id: "023_test_metric_catalogue",
    up: db => {
      if (!hasColumn(db, "test_metric_config", "aliases")) {
        db.exec("ALTER TABLE test_metric_config ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]'")
      }
      if (!hasColumn(db, "test_metric_config", "panel")) {
        db.exec("ALTER TABLE test_metric_config ADD COLUMN panel TEXT")
      }
      if (!hasColumn(db, "test_metric_config", "value_type")) {
        db.exec("ALTER TABLE test_metric_config ADD COLUMN value_type TEXT NOT NULL DEFAULT 'numeric'")
      }
      if (!hasColumn(db, "test_result_values", "limit_qualifier")) {
        db.exec(
          "ALTER TABLE test_result_values ADD COLUMN limit_qualifier TEXT CHECK (limit_qualifier IN ('<', '<=', '>', '>='))",
        )
      }
      syncTestMetricCatalogue(db)
    },
  },
  {
    // Free-text notes on symptom events (Record X form sweep). Also in `applyBaselineSchema()`.
    id: "024_symptom_events_notes",
    up: db => {
      if (!hasColumn(db, "symptom_events", "notes")) {
        db.exec("ALTER TABLE symptom_events ADD COLUMN notes TEXT")
      }
    },
  },
  {
    // Local day an Open symptom was last confirmed as still ongoing (the daily dashboard prompt).
    // Also in `applyBaselineSchema()`.
    id: "025_symptom_events_ongoing_confirmed_on",
    up: db => {
      if (!hasColumn(db, "symptom_events", "ongoing_confirmed_on")) {
        db.exec("ALTER TABLE symptom_events ADD COLUMN ongoing_confirmed_on TEXT")
      }
    },
  },
  {
    // Catalogue additions seen on real SA Pathology reports (five metrics and a few aliases):
    // re-syncs the curated catalogue; units and hidden state of existing rows are kept.
    id: "026_test_metric_catalogue_additions",
    up: db => {
      syncTestMetricCatalogue(db)
    },
  },
  {
    // Opt-in, descriptive links between symptoms and medication doses. Also in `applyBaselineSchema()`.
    id: "027_symptom_dose_links",
    up: db => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS symptom_dose_links (
          symptom_event_id     INTEGER NOT NULL REFERENCES symptom_events(id)     ON DELETE CASCADE,
          medication_record_id INTEGER NOT NULL REFERENCES medication_records(id) ON DELETE CASCADE,
          person_id            INTEGER NOT NULL REFERENCES people(id),
          created_by           TEXT,
          created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (symptom_event_id, medication_record_id)
        );
        CREATE INDEX IF NOT EXISTS idx_symptom_dose_links_record ON symptom_dose_links(medication_record_id);
        CREATE INDEX IF NOT EXISTS idx_symptom_dose_links_person ON symptom_dose_links(person_id);
      `)
    },
  },
  {
    // The retired schedule-frequency alias stored the same meaning as daily. Rewrite those
    // JSON values in place. Skip when the column is absent (older stub schemas) and leave
    // every other row untouched, so a second run finds nothing to change.
    id: "028_normalise_twice_daily_schedule_frequency",
    up: db => {
      if (!hasColumn(db, "person_medications", "schedule_frequency")) return
      const rows = db
        .prepare(
          "SELECT id, schedule_frequency FROM person_medications WHERE schedule_frequency IS NOT NULL",
        )
        .all() as { id: number; schedule_frequency: string }[]
      const update = db.prepare(
        "UPDATE person_medications SET schedule_frequency = ? WHERE id = ?",
      )
      const rewrite = db.transaction(() => {
        for (const row of rows) {
          let parsed: unknown
          try {
            parsed = JSON.parse(row.schedule_frequency)
          } catch {
            continue
          }
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue
          const freq = parsed as Record<string, unknown>
          if (freq.kind !== "twice_daily") continue
          freq.kind = "daily"
          update.run(JSON.stringify(freq), row.id)
        }
      })
      rewrite()
    },
  },
  {
    id: "029_entra_removed_accounts",
    up: db => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS entra_removed_accounts (
          oid_hash    TEXT PRIMARY KEY,
          removed_at  TEXT NOT NULL
        )
      `)
    },
  },
  {
    // slot_outcomes — also added to `applyBaselineSchema()` for fresh installs; `IF NOT EXISTS`
    // keeps this idempotent. Separate from dose_expectation_outcomes, which stays as it was.
    id: "030_slot_outcomes",
    up: db => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS slot_outcomes (
          id                    INTEGER PRIMARY KEY AUTOINCREMENT,
          person_medication_id  INTEGER NOT NULL REFERENCES person_medications(id) ON DELETE CASCADE,
          local_ymd             TEXT    NOT NULL,
          slot_hhmm             TEXT    NOT NULL,
          result                TEXT    NOT NULL CHECK (result IN ('on_time', 'early', 'late', 'missed', 'given')),
          -- Minutes from the slot to the attached dose (negative = early); NULL for missed and given.
          offset_minutes        INTEGER,
          -- Only for missed: timed_out | not_given | early_answer.
          missed_cause          TEXT    CHECK (missed_cause IN ('timed_out', 'not_given', 'early_answer')),
          -- Deleting the attached dose reopens the slot; missed rows have no dose.
          medication_record_id  INTEGER REFERENCES medication_records(id) ON DELETE CASCADE,
          created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(person_medication_id, local_ymd, slot_hhmm)
        );
        CREATE INDEX IF NOT EXISTS idx_slot_outcomes_record ON slot_outcomes(medication_record_id);
      `)
    },
  },
  {
    // Person erase blanks the audit rows of every record it deletes, one lookup by entity each. Without
    // this index each lookup scans the whole audit log, so erase time grew with records times audit rows.
    id: "031_audit_log_entity_index",
    up: db => {
      // The baseline creates the table before migrations run; a hand-built test database may not have it.
      const hasAuditLog = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'audit_log'").get()
      if (hasAuditLog) db.exec("CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id)")
    },
  },
  {
    // The opt-in "cancel the next slot" feature is gone: an early dose now attaches to the next slot
    // through the timing prompt, and the History association radius setting is retired with it (a stored
    // value is dropped; the environment variable is simply no longer read). Fresh installs never create the
    // table; `IF EXISTS` keeps this idempotent.
    id: "032_drop_schedule_reminder_suppressions",
    up: db => {
      db.exec(`
        DROP INDEX IF EXISTS idx_sched_supp_ymd;
        DROP TABLE IF EXISTS schedule_reminder_suppressions;
      `)
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_settings'").get()) {
        db.prepare("DELETE FROM app_settings WHERE key = ?").run("schedule.slot_association_radius_minutes")
      }
    },
  },
  {
    // Restore looks a test event up by Person, name and date to skip duplicates; the Person index alone
    // scanned all of that Person's events for each one.
    id: "033_test_events_dedupe_index",
    up: db => {
      const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'test_events'").get()
      if (hasTable) db.exec("CREATE INDEX IF NOT EXISTS idx_test_events_person_date_name ON test_events(person_id, date, name)")
    },
  },
  {
    // The instant a schedule was created, so a schedule made part-way through its start day begins at
    // the next dose. Creation only: edits never change it. Older rows stay NULL (no boundary). Also in
    // `applyBaselineSchema()`, so guard against the column already existing.
    id: "034_person_medication_schedule_created_at",
    up: db => {
      const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'person_medications'").get()
      if (hasTable && !hasColumn(db, "person_medications", "schedule_created_at_ms")) {
        db.exec("ALTER TABLE person_medications ADD COLUMN schedule_created_at_ms INTEGER")
      }
    },
  },
]

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
