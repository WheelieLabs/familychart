// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { writeUpload } from "@/lib/uploads/store"

/**
 * The household shared by the export and restore tests, on a database built with
 * `applyBaselineSchema`: two active Persons and one inactive, medications with frequency rules
 * and schedules, doses, observations (including a blood pressure pair), a test result with a
 * report, a symptom linked to a dose, goals, expectations and Accounts of every kind.
 *
 * Accounts: 1 Admin, 2 None-role linked to Sam (person 2), 3 Manager, 4 ReadWrite, 5 None-role
 * with no link.
 */
export async function seedExportHousehold(db: Database.Database): Promise<void> {
  db.exec(`
    INSERT INTO accounts (id, email, role) VALUES
      (1, 'admin@example.com', 'admin'),
      (2, 'sam@example.com', 'none'),
      (3, 'manager@example.com', 'manage'),
      (4, 'writer@example.com', 'write'),
      (5, 'unlinked@example.com', 'none');

    INSERT INTO people (id, name, full_name, date_of_birth, color, photo_url, account_uid, is_active) VALUES
      (1, 'Alex', 'Alex Example', '2015-04-02', '#AA3311', '/api/uploads/people/alex-photo.jpg', NULL, 1),
      (2, 'Sam', 'Sam Example', '2001-09-30', '#11AA33', NULL, 'local:2', 1),
      (3, 'Robin', 'Robin Example', '1950-01-01', '#3311AA', NULL, NULL, 0);

    INSERT INTO medications (id, name, default_dosage, dosage_unit, notes, min_age_years, max_age_years, is_active) VALUES
      (10, 'Paracetamol', 250, 'mg', 'With food', 2, NULL, 1),
      (11, 'Ibuprofen', 200, 'mg', NULL, 6, 65, 0),
      (12, 'Melatonin', 3, 'mg', NULL, NULL, NULL, 1),
      (13, 'Unused', 1, 'Tabs', NULL, NULL, NULL, 1);

    INSERT INTO medication_frequency_rules
      (medication_id, min_hours_between, max_hours_between, max_quantity_per_24h, max_quantity_unit, min_age_years, max_per_24h_count_doses)
    VALUES
      (10, 4, NULL, 1000, 'mg', 2, 0),
      (11, 6, 8, 3, 'doses', NULL, 1),
      (12, 24, NULL, NULL, NULL, NULL, 0);

    INSERT INTO person_medications
      (id, person_id, medication_id, is_active, schedule_times, schedule_frequency, schedule_start_date, schedule_end_date, schedule_slots, schedule_tz, schedule_created_at_ms)
    VALUES
      (20, 1, 10, 1, '["08:00"]', 'daily', '2026-01-01', NULL, NULL, 'Europe/London', 1767268800000),
      (21, 1, 11, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
      (22, 2, 12, 1, '["21:00"]', 'daily', '2026-01-01', NULL, NULL, 'Europe/London', NULL);

    INSERT INTO medication_records (id, person_id, medication_id, recorded_at, dosage, dosage_unit, comments, created_by, administered_by) VALUES
      (30, 1, 10, '2026-02-01T08:00:00.000Z', 250, 'mg', 'After breakfast', 'admin@example.com', 'me'),
      (31, 1, 11, '2026-02-01T14:00:00.000Z', 200, 'mg', NULL, 'writer@example.com', 'away_from_home'),
      (32, 2, 12, '2026-02-01T21:00:00.000Z', 3, 'mg', NULL, 'sam@example.com', NULL);

    INSERT INTO dose_expectations (id, person_medication_id, slot_hhmm, start_date, end_date, weekdays, created_by) VALUES
      (40, 20, '08:00', '2026-01-01', '2026-12-31', '1,2,3,4,5', 'admin@example.com');
    INSERT INTO dose_expectation_exceptions (dose_expectation_id, local_ymd) VALUES (40, '2026-02-02');
    INSERT INTO dose_expectation_outcomes
      (dose_expectation_id, local_ymd, status, snoozed_until, slot_at, medication_record_id, resolved_by, resolved_at)
    VALUES
      (40, '2026-02-01', 'confirmed_given', NULL, '2026-02-01T08:00:00.000Z', 30, 'admin@example.com', '2026-02-01T08:01:00.000Z'),
      (40, '2026-02-03', 'confirmed_missed', NULL, '2026-02-03T08:00:00.000Z', NULL, 'admin@example.com', '2026-02-03T10:00:00.000Z');

    INSERT INTO slot_outcomes
      (person_medication_id, local_ymd, slot_hhmm, result, offset_minutes, missed_cause, medication_record_id)
    VALUES
      (20, '2026-02-01', '08:00', 'on_time', 0, NULL, 30),
      (20, '2026-02-03', '08:00', 'missed', NULL, 'timed_out', NULL),
      (22, '2026-02-01', '21:00', 'late', 15, NULL, 32);

    INSERT INTO observations (id, person_id, observation_type, value, unit, value_label, recorded_at, comments, session_id, created_by) VALUES
      (50, 1, 'Weight', 21.5, 'kg', NULL, '2026-02-01T09:00:00.000Z', 'Shoes off', NULL, 'admin@example.com'),
      (51, 1, 'Blood Pressure', 105, 'mmHg', 'systolic', '2026-02-01T09:05:00.000Z', NULL, 'session-a', 'admin@example.com'),
      (52, 1, 'Blood Pressure', 68, 'mmHg', 'diastolic', '2026-02-01T09:05:00.000Z', NULL, 'session-a', 'admin@example.com'),
      (53, 1, 'Head Circumference', 52, 'cm', NULL, '2026-01-01T09:00:00.000Z', NULL, NULL, 'admin@example.com'),
      (54, 2, 'Weight', 70, 'kg', NULL, '2026-02-01T09:00:00.000Z', NULL, NULL, 'sam@example.com');

    INSERT INTO test_events (id, person_id, test_type, name, date, ordered_by, notes, attachment_url, created_by) VALUES
      (60, 1, 'Blood', 'Iron studies', '2026-01-15', 'Dr Smith', 'Fasting', '/api/test-results/uploads/88888888-8888-4888-8888-888888888888.pdf', 'admin@example.com');
    INSERT INTO test_result_values (test_event_id, metric_name, value_type, numeric_value, qualitative_value, unit, reference_range, flag, limit_qualifier) VALUES
      (60, 'Ferritin', 'numeric', 30, NULL, 'ug/L', '20 - 200', NULL, NULL),
      (60, 'Iron', 'numeric', 5, NULL, 'umol/L', NULL, 'differs from expected', '<'),
      (60, 'Coeliac screen', 'qualitative', NULL, 'Negative', NULL, NULL, NULL, NULL);

    INSERT INTO symptom_events (id, person_id, label, start_date, end_date, severity, is_resolved, resolved_at, notes, created_by) VALUES
      (70, 1, 'Headache', '2026-01-31T13:30:00.000Z', '2026-02-01T13:30:00.000Z', 2, 1, '2026-02-01T12:00:00.000Z', 'After school', 'admin@example.com');
    INSERT INTO symptom_dose_links (symptom_event_id, medication_record_id, person_id, created_by) VALUES (70, 30, 1, 'admin@example.com');

    INSERT INTO observation_goals (person_id, observation_type, goal_type, target_value, target_max, unit, is_active, target_date) VALUES
      (1, 'Hydration', 'daily_min', 1200, NULL, 'mL', 1, NULL);
    INSERT INTO person_observation_expectations (person_id, observation_type, cadence, interval_days, enabled, due_time_hhmm, tz) VALUES
      (1, 'Weight', 'custom_days', 30, 1, '09:00', 'Europe/London');

    UPDATE observation_type_config SET is_active = 0 WHERE observation_type = 'Head Circumference';
    INSERT INTO test_metric_config (metric_name, is_active) VALUES ('Ferritin', 1), ('Iron', 0);
  `)
  await writeUpload("people", "alex-photo.jpg", Buffer.from("alex-jpeg-bytes"))
  await writeUpload("test-results", "88888888-8888-4888-8888-888888888888.pdf", Buffer.from("iron-pdf-bytes"))
}
