// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import path from "path"
import fs from "fs"
import { runMigrations } from "./db-migrations"
import { applyCipherProfile } from "./encryption/cipher-profile"
import { getDbKey, hasDbKey } from "./encryption/db-key"
import { encryptionActive, getEncryptionMode } from "./encryption/mode"
import { validateDemoModeAtBoot } from "./demo/demo-mode"
import { validateRegistryEnvAtBoot } from "./settings/resolver"
import { ensureVapidKeysGenerated } from "./vapid-config"

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "familychart.db")
const dataDir = path.dirname(DB_PATH)
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

/** Directory containing the SQLite file (uploads, backups). */
export function getDataDir(): string {
  return dataDir
}

let _db: Database.Database | null = null
let _envValidated = false

export function getDb(): Database.Database {
  if (!_db) {
    const mode = getEncryptionMode()
    if (encryptionActive(mode) && !hasDbKey()) {
      throw new Error("Database encryption key not acquired — cannot open database")
    }
    _db = new Database(DB_PATH)
    if (encryptionActive(mode)) {
      applyCipherProfile(_db, getDbKey())
    }
    _db.pragma("journal_mode = WAL")
    _db.pragma("foreign_keys = ON")
    applyBaselineSchema(_db)
    runMigrations(_db)
    if (!_envValidated) {
      validateDemoModeAtBoot()
      validateRegistryEnvAtBoot()
      _envValidated = true
    }
    ensureVapidKeysGenerated(_db)
  }
  return _db
}

/**
 * Live 1.0.0 baseline DDL (Accounts unified, `people.account_uid`, Invite columns,
 * `must_reset_password`) — every `CREATE ... IF NOT EXISTS`, so this is safe to re-run:
 * Next.js can load `lib/db.ts` more than once (instrumentation vs the request bundle),
 * so `getDb()` is not a process-wide singleton and a second open must not throw.
 */
export function applyBaselineSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      email                TEXT NOT NULL UNIQUE,
      password_hash        TEXT,
      role                 TEXT NOT NULL DEFAULT 'write',
      is_active            INTEGER NOT NULL DEFAULT 1,
      can_report           INTEGER NOT NULL DEFAULT 0,
      totp_secret          TEXT,
      totp_secret_pending  TEXT,
      session_version      INTEGER NOT NULL DEFAULT 0,
      must_reset_password  INTEGER NOT NULL DEFAULT 0,
      auth_method          TEXT NOT NULL DEFAULT 'local',
      external_id          TEXT,
      status               TEXT NOT NULL DEFAULT 'active',
      invite_token_hash    TEXT,
      invite_expires_at    DATETIME,
      invite_revoked_at    DATETIME,
      created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS medication_groups (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      notes       TEXT,
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS people (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      full_name     TEXT,
      photo_url     TEXT,
      color         TEXT    NOT NULL DEFAULT '#256AA5',
      sort_order    INTEGER NOT NULL DEFAULT 0,
      is_active     INTEGER NOT NULL DEFAULT 1,
      account_uid   TEXT,
      date_of_birth TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_people_account_uid_unique
      ON people(account_uid) WHERE account_uid IS NOT NULL;

    CREATE TABLE IF NOT EXISTS medications (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      default_dosage  REAL,
      dosage_unit     TEXT    NOT NULL DEFAULT 'Tabs',
      notes           TEXT,
      min_age_years   INTEGER,
      max_age_years   INTEGER,
      is_active       INTEGER NOT NULL DEFAULT 1,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS medication_group_members (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      medication_id INTEGER NOT NULL REFERENCES medications(id),
      group_id      INTEGER NOT NULL REFERENCES medication_groups(id),
      UNIQUE(medication_id, group_id)
    );
    CREATE INDEX IF NOT EXISTS idx_mgm_med   ON medication_group_members(medication_id);
    CREATE INDEX IF NOT EXISTS idx_mgm_group ON medication_group_members(group_id);

    CREATE TABLE IF NOT EXISTS person_medications (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id           INTEGER NOT NULL REFERENCES people(id),
      medication_id       INTEGER NOT NULL REFERENCES medications(id),
      is_active           INTEGER NOT NULL DEFAULT 1,
      schedule_times       TEXT,
      schedule_frequency   TEXT,
      schedule_start_date  TEXT,
      schedule_end_date    TEXT,
      schedule_slots       TEXT,
      schedule_tz          TEXT,
      -- Epoch ms the schedule was created; slots on its start day before this instant are not expectations.
      schedule_created_at_ms INTEGER,
      UNIQUE(person_id, medication_id)
    );

    CREATE TABLE IF NOT EXISTS medication_records (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id       INTEGER NOT NULL REFERENCES people(id),
      medication_id   INTEGER NOT NULL REFERENCES medications(id),
      recorded_at     DATETIME NOT NULL,
      dosage          REAL,
      dosage_unit     TEXT,
      comments        TEXT,
      created_by      TEXT,
      -- Who gave the dose: "me" (default when NULL) | "another_caregiver" | "away_from_home".
      administered_by TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS observations (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id        INTEGER NOT NULL REFERENCES people(id),
      observation_type TEXT    NOT NULL,
      value            REAL    NOT NULL,
      unit             TEXT    NOT NULL,
      recorded_at      DATETIME NOT NULL,
      comments         TEXT,
      created_by       TEXT,
      session_id       TEXT,
      value_label      TEXT,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email  TEXT,
      action      TEXT    NOT NULL,
      entity_type TEXT    NOT NULL,
      entity_id   INTEGER,
      details     TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);

    CREATE TABLE IF NOT EXISTS medication_frequency_rules (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      medication_id           INTEGER REFERENCES medications(id),
      min_hours_between       REAL    NOT NULL,
      max_hours_between       REAL,
      max_quantity_per_24h    REAL,
      max_quantity_unit       TEXT,
      min_age_years           INTEGER,
      max_age_years           INTEGER,
      dosage                  REAL,
      min_weight_kg           REAL,
      max_weight_kg           REAL,
      max_per_24h_count_doses INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_freq_rules_med   ON medication_frequency_rules(medication_id);

    CREATE INDEX IF NOT EXISTS idx_medrec_person      ON medication_records(person_id);
    CREATE INDEX IF NOT EXISTS idx_medrec_date        ON medication_records(recorded_at);
    CREATE INDEX IF NOT EXISTS idx_medrec_med         ON medication_records(medication_id);
    CREATE INDEX IF NOT EXISTS idx_medrec_person_date ON medication_records(person_id, recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_medication_records_person_med_recorded
      ON medication_records(person_id, medication_id, recorded_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_obs_person         ON observations(person_id);
    CREATE INDEX IF NOT EXISTS idx_obs_date           ON observations(recorded_at);
    CREATE INDEX IF NOT EXISTS idx_obs_type           ON observations(observation_type);
    CREATE INDEX IF NOT EXISTS idx_obs_person_date    ON observations(person_id, recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_observations_person_type_recorded
      ON observations(person_id, observation_type, recorded_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS person_observation_expectations (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id                   INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      observation_type          TEXT    NOT NULL,
      cadence                     TEXT    NOT NULL,
      interval_days               REAL,
      recurrence_day_of_month     INTEGER,
      recurrence_month            INTEGER,
      recurrence_day              INTEGER,
      recurrence_use_birthday     INTEGER NOT NULL DEFAULT 0,
      enabled                     INTEGER NOT NULL DEFAULT 1,
      due_time_hhmm               TEXT    NOT NULL DEFAULT '00:00',
      tz                          TEXT,
      UNIQUE(person_id, observation_type)
    );
    CREATE INDEX IF NOT EXISTS idx_poe_person ON person_observation_expectations(person_id);

    CREATE TABLE IF NOT EXISTS observation_type_config (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      observation_type TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      is_static        INTEGER NOT NULL DEFAULT 0,
      chart_type       TEXT    NOT NULL DEFAULT 'line',
      typical_unit     TEXT,
      sort_order       INTEGER NOT NULL DEFAULT 0,
      max_age_years    REAL,
      stale_after_hours REAL,
      is_active        INTEGER NOT NULL DEFAULT 1,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Curated metric-name catalogue for test results (mirrors observation_type_config /
    -- ADR-0012): names, units, aliases, panel and value type only (seeded by the catalogue migration, see
    -- lib/test-results/test-metric-catalogue.ts), no reference-range/flag columns —
    -- those are transcribed per test event from the report in hand, never pre-populated.
    CREATE TABLE IF NOT EXISTS test_metric_config (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      metric_name TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      unit        TEXT,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      aliases     TEXT    NOT NULL DEFAULT '[]', -- JSON array of search/report-matching aliases
      panel       TEXT,                          -- label for telling similar metrics apart
      value_type  TEXT    NOT NULL DEFAULT 'numeric' -- 'numeric' | 'qualitative'
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

    -- Curated metric subset worth charting/flagging — the attachment stays the source of
    -- truth, this is not a full transcription of the report.
    CREATE TABLE IF NOT EXISTS test_result_values (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      test_event_id     INTEGER NOT NULL REFERENCES test_events(id) ON DELETE CASCADE,
      metric_name       TEXT    NOT NULL,
      value_type        TEXT    NOT NULL, -- 'numeric' | 'qualitative'
      numeric_value     REAL,
      qualitative_value TEXT,
      unit              TEXT,
      reference_range   TEXT,
      flag              TEXT,             -- e.g. 'differs from expected' | NULL
      limit_qualifier   TEXT CHECK (limit_qualifier IN ('<', '<=', '>', '>=')), -- "< 20" is 20 with '<'
      CHECK (
        (value_type = 'numeric'     AND numeric_value     IS NOT NULL AND qualitative_value IS NULL)
        OR
        (value_type = 'qualitative' AND qualitative_value IS NOT NULL AND numeric_value     IS NULL)
      )
    );
    CREATE INDEX IF NOT EXISTS idx_test_events_person ON test_events(person_id);
    CREATE INDEX IF NOT EXISTS idx_test_events_date   ON test_events(date);
    CREATE INDEX IF NOT EXISTS idx_test_events_person_date_name ON test_events(person_id, date, name);
    CREATE INDEX IF NOT EXISTS idx_test_result_values_event ON test_result_values(test_event_id);

    CREATE TABLE IF NOT EXISTS symptom_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id    INTEGER NOT NULL REFERENCES people(id),
      label        TEXT    NOT NULL,
      start_date   TEXT    NOT NULL,
      end_date     TEXT,
      severity     INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 5),
      is_resolved  INTEGER NOT NULL DEFAULT 0,
      resolved_at  DATETIME,
      notes        TEXT,
      ongoing_confirmed_on TEXT, -- local YYYY-MM-DD of the last "still ongoing" answer to the daily prompt
      created_by   TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_symptom_events_person      ON symptom_events(person_id);
    CREATE INDEX IF NOT EXISTS idx_symptom_events_date        ON symptom_events(start_date);
    CREATE INDEX IF NOT EXISTS idx_symptom_events_person_date ON symptom_events(person_id, start_date DESC);

    -- Descriptive link: "this dose relates to this symptom". Many-to-many, same Person (checked in the
    -- write path), removed with either side.
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
      slot_at               DATETIME,
      medication_record_id  INTEGER REFERENCES medication_records(id) ON DELETE SET NULL,
      resolved_by           TEXT,
      resolved_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(dose_expectation_id, local_ymd)
    );

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

    CREATE TABLE IF NOT EXISTS push_endpoints (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_uid       TEXT NOT NULL,
      endpoint       TEXT NOT NULL,
      p256dh         TEXT NOT NULL,
      web_push_auth  TEXT NOT NULL,
      user_agent     TEXT,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used_at   DATETIME,
      UNIQUE(user_uid, endpoint)
    );
    CREATE INDEX IF NOT EXISTS idx_push_endpoints_uid ON push_endpoints(user_uid);

    CREATE TABLE IF NOT EXISTS system_config (
      key        TEXT UNIQUE NOT NULL,
      value      TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS person_notification_prefs (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id           INTEGER NOT NULL REFERENCES people(id),
      user_uid            TEXT NOT NULL,
      notify_prn          INTEGER NOT NULL DEFAULT 1,
      notify_prescribed   INTEGER NOT NULL DEFAULT 1,
      notify_overdue      INTEGER NOT NULL DEFAULT 1,
      notify_observations INTEGER NOT NULL DEFAULT 0,
      notify_hydration    INTEGER NOT NULL DEFAULT 1,
      UNIQUE(person_id, user_uid)
    );
    CREATE INDEX IF NOT EXISTS idx_pnp_person ON person_notification_prefs(person_id);
    CREATE INDEX IF NOT EXISTS idx_pnp_uid    ON person_notification_prefs(user_uid);

    CREATE TABLE IF NOT EXISTS prn_push_requests (
      medication_record_id INTEGER PRIMARY KEY REFERENCES medication_records(id) ON DELETE CASCADE,
      requested_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      remind_after_hours   REAL
    );

    CREATE TABLE IF NOT EXISTS push_log (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      ref_key TEXT NOT NULL UNIQUE,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS observation_goals (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id        INTEGER NOT NULL,
      observation_type TEXT    NOT NULL,
      goal_type        TEXT    NOT NULL DEFAULT 'daily_min',
      target_value     REAL    NOT NULL,
      target_max       REAL,
      unit             TEXT    NOT NULL,
      is_active        INTEGER NOT NULL DEFAULT 1,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      target_date      TEXT,
      UNIQUE(person_id, observation_type, goal_type)
    );
    CREATE INDEX IF NOT EXISTS idx_obs_goals_person ON observation_goals(person_id);

    CREATE TABLE IF NOT EXISTS favourites (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_uid         TEXT    NOT NULL,
      person_id        INTEGER NOT NULL REFERENCES people(id),
      action_kind      TEXT    NOT NULL,
      medication_id    INTEGER REFERENCES medications(id),
      observation_type TEXT,
      default_value    TEXT,
      label            TEXT,
      sort_order       INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_favourites_user_uid ON favourites(user_uid);

    CREATE TABLE IF NOT EXISTS user_app_state (
      user_uid          TEXT PRIMARY KEY,
      last_seen_version TEXT,
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_uid    TEXT NOT NULL,
      key         TEXT NOT NULL,
      value       TEXT NOT NULL,
      updated_at  INTEGER NOT NULL,
      PRIMARY KEY (user_uid, key)
    );
    CREATE INDEX IF NOT EXISTS idx_user_settings_uid ON user_settings(user_uid);

    CREATE TABLE IF NOT EXISTS app_settings (
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (key)
    );

    CREATE TABLE IF NOT EXISTS notification_log (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_user_id  TEXT NOT NULL,
      person_id          INTEGER NOT NULL REFERENCES people(id),
      type               TEXT NOT NULL,
      title              TEXT NOT NULL,
      body               TEXT NOT NULL,
      sent_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_notification_log_recipient
      ON notification_log(recipient_user_id, sent_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS entra_removed_accounts (
      oid_hash    TEXT PRIMARY KEY,
      removed_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_revalidation_status (
      provider        TEXT NOT NULL,
      external_id     TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'ok',
      last_checked_at INTEGER,
      groups_json     TEXT,
      email           TEXT,
      display_name    TEXT,
      updated_at      INTEGER NOT NULL,
      PRIMARY KEY (provider, external_id)
    );
  `)
  seedObservationTypeConfig(db)
}

const SEED_OBSERVATION_TYPE_CONFIG: [string, number, string, string | null, number, number | null, number | null][] = [
  ["Weight", 0, "line", "kg", 1, null, 336],
  ["Height", 1, "line", "cm", 2, null, null],
  ["Temperature", 0, "line", "°C", 3, null, 24],
  ["Blood Pressure", 0, "line", "mmHg", 4, null, 72],
  ["Heart Rate", 0, "line", "bpm", 5, null, 48],
  ["SpO2", 0, "line", "%", 6, null, 24],
  ["Blood Glucose", 0, "line", "mmol/L", 7, null, 12],
  ["Respirations", 0, "line", "breaths/min", 8, null, 48],
  ["Head Circumference", 1, "line", "cm", 9, 3, 720],
  ["Hydration", 0, "bar", "mL", 10, null, 24],
]

/** Default observation-type catalogue rows. Idempotent — safe to re-run on every boot. */
function seedObservationTypeConfig(db: Database.Database): void {
  const ins = db.prepare(
    `INSERT OR IGNORE INTO observation_type_config
      (observation_type, is_static, chart_type, typical_unit, sort_order, max_age_years, stale_after_hours)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const row of SEED_OBSERVATION_TYPE_CONFIG) {
    ins.run(...row)
  }
}

