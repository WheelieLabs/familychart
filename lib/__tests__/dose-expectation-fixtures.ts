/** DDL for the dose-expectation and slot-outcome tables, for hand-built test databases that don't use applyBaselineSchema. */
export const DOSE_EXPECTATION_TABLES_SQL = `
  CREATE TABLE dose_expectations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_medication_id INTEGER NOT NULL,
    slot_hhmm TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    weekdays TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE dose_expectation_exceptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dose_expectation_id INTEGER NOT NULL,
    local_ymd TEXT NOT NULL,
    UNIQUE(dose_expectation_id, local_ymd)
  );
  CREATE TABLE dose_expectation_outcomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dose_expectation_id INTEGER NOT NULL,
    local_ymd TEXT NOT NULL,
    status TEXT NOT NULL,
    snoozed_until DATETIME,
    medication_record_id INTEGER,
    resolved_by TEXT,
    resolved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(dose_expectation_id, local_ymd)
  );
  CREATE TABLE slot_outcomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_medication_id INTEGER NOT NULL,
    local_ymd TEXT NOT NULL,
    slot_hhmm TEXT NOT NULL,
    result TEXT NOT NULL,
    offset_minutes INTEGER,
    missed_cause TEXT,
    medication_record_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(person_medication_id, local_ymd, slot_hhmm)
  );
`
