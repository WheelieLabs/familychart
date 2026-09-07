import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  loadMedicationDoseState,
  evaluatePrnState,
  doseSliceFromMaps,
  type MedicationDoseSlice,
} from "@/lib/medication/medication-dose-state"
import type { FrequencyRule } from "@/lib/domain-types"

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE people (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      date_of_birth TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      color TEXT NOT NULL DEFAULT '#000',
      sort_order INTEGER NOT NULL DEFAULT 0,
      account_uid TEXT,
      full_name TEXT,
      photo_url TEXT
    );
    CREATE TABLE medications (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      dosage_unit TEXT NOT NULL DEFAULT 'Tabs',
      default_dosage REAL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE medication_groups (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE medication_group_members (
      group_id INTEGER NOT NULL,
      medication_id INTEGER NOT NULL
    );
    CREATE TABLE medication_frequency_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medication_id INTEGER,
      min_hours_between REAL NOT NULL DEFAULT 0,
      max_hours_between REAL,
      max_quantity_per_24h REAL,
      max_quantity_unit TEXT,
      max_per_24h_count_doses INTEGER NOT NULL DEFAULT 0,
      min_age_years REAL,
      max_age_years REAL,
      min_weight_kg REAL,
      max_weight_kg REAL,
      dosage REAL
    );
    CREATE TABLE person_medications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      medication_id INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      schedule_times TEXT,
      schedule_frequency TEXT,
      schedule_start_date TEXT,
      schedule_end_date TEXT,
      schedule_slots TEXT,
      schedule_tz TEXT
    );
    CREATE TABLE medication_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      medication_id INTEGER NOT NULL,
      recorded_at TEXT NOT NULL,
      dosage REAL,
      dosage_unit TEXT
    );
    CREATE TABLE prn_push_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medication_record_id INTEGER NOT NULL,
      remind_after_hours REAL
    );
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      observation_type TEXT NOT NULL,
      value REAL,
      recorded_at TEXT NOT NULL,
      unit TEXT
    );
    CREATE TABLE app_settings (
      key TEXT NOT NULL PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  return db
}

function baseRule(overrides: Partial<FrequencyRule> = {}): FrequencyRule {
  return {
    id: 1,
    medication_id: 1,
    min_hours_between: 4,
    max_hours_between: null,
    max_quantity_per_24h: null,
    max_quantity_unit: null,
    max_per_24h_count_doses: 0,
    min_age_years: null,
    max_age_years: null,
    min_weight_kg: null,
    max_weight_kg: null,
    dosage: null,
    ...overrides,
  }
}

function emptySlice(overrides: Partial<MedicationDoseSlice> = {}): MedicationDoseSlice {
  return {
    rule: null,
    total24h: 0,
    lastDose: null,
    oldest24h: null,
    lastDosage: null,
    catalogDefaultDosage: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// loadMedicationDoseState
// ---------------------------------------------------------------------------

describe("loadMedicationDoseState", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
    db.prepare("INSERT INTO medications (id, name, dosage_unit, default_dosage) VALUES (1, 'Panadol', 'Tabs', 2)").run()
    db.prepare("INSERT INTO person_medications (person_id, medication_id, is_active) VALUES (1, 1, 1)").run()
  })

  afterEach(() => db.close())

  it("returns empty maps for empty people list", () => {
    const maps = loadMedicationDoseState(db, [])
    expect(maps.ruleByPersonMed.size).toBe(0)
    expect(maps.total24hByPersonMed.size).toBe(0)
  })

  it("loads catalogue default dosage", () => {
    const maps = loadMedicationDoseState(db, [{ id: 1, date_of_birth: null }])
    expect(maps.catalogDefaultDosageByMed.get(1)).toBe(2)
  })

  it("picks up active person_medications", () => {
    const maps = loadMedicationDoseState(db, [{ id: 1, date_of_birth: null }])
    const freq = maps.frequencyMedIdsByPerson.get(1)
    expect(freq?.has(1)).toBe(true)
  })

  it("picks up recently dosed meds even when person_medication is inactive", () => {
    db.prepare("UPDATE person_medications SET is_active = 0 WHERE person_id = 1").run()
    db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES (1, 1, datetime('now', '-1 hour'))",
    ).run()
    const maps = loadMedicationDoseState(db, [{ id: 1, date_of_birth: null }])
    expect(maps.frequencyMedIdsByPerson.get(1)?.has(1)).toBe(true)
  })

  it("records rolling 24h total from dose history", () => {
    db.prepare("INSERT INTO medication_frequency_rules (medication_id, min_hours_between, max_quantity_per_24h, max_per_24h_count_doses) VALUES (1, 4, 3, 1)").run()
    db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES (1, 1, datetime('now', '-2 hours'))",
    ).run()
    db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES (1, 1, datetime('now', '-1 hour'))",
    ).run()
    const maps = loadMedicationDoseState(db, [{ id: 1, date_of_birth: null }])
    expect(maps.total24hByPersonMed.get("1:1")).toBe(2)
  })

  it("records lastDose from medication_records", () => {
    const recentIso = new Date(Date.now() - 3 * 3_600_000).toISOString()
    db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES (1, 1, ?)",
    ).run(recentIso)
    const maps = loadMedicationDoseState(db, [{ id: 1, date_of_birth: null }])
    expect(maps.lastDoseByPersonMed.get("1:1")?.lastIso).toBe(recentIso)
  })

  it("includes lastMedName from medication_records join", () => {
    const recentIso = new Date(Date.now() - 3 * 3_600_000).toISOString()
    db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES (1, 1, ?)",
    ).run(recentIso)
    const maps = loadMedicationDoseState(db, [{ id: 1, date_of_birth: null }])
    expect(maps.lastDoseByPersonMed.get("1:1")?.lastMedName).toBe("Panadol")
  })

  it("null oldest24h when no cap configured", () => {
    db.prepare("INSERT INTO medication_frequency_rules (medication_id, min_hours_between) VALUES (1, 4)").run()
    const maps = loadMedicationDoseState(db, [{ id: 1, date_of_birth: null }])
    expect(maps.oldest24hByPersonMed.get("1:1")).toBeNull()
  })

  it("non-null oldest24h when cap is configured and dose exists", () => {
    db.prepare("INSERT INTO medication_frequency_rules (medication_id, min_hours_between, max_quantity_per_24h, max_per_24h_count_doses) VALUES (1, 4, 3, 1)").run()
    const iso = new Date(Date.now() - 2 * 3_600_000).toISOString()
    db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES (1, 1, ?)",
    ).run(iso)
    const maps = loadMedicationDoseState(db, [{ id: 1, date_of_birth: null }])
    expect(maps.oldest24hByPersonMed.get("1:1")).not.toBeNull()
  })

  it("records rolling 24h total from summed dosage when rule is quantity-mode (not dose-count)", () => {
    db.prepare(
      "INSERT INTO medication_frequency_rules (medication_id, min_hours_between, max_quantity_per_24h, max_quantity_unit, max_per_24h_count_doses) VALUES (1, 4, 10, 'Tabs', 0)",
    ).run()
    db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at, dosage, dosage_unit) VALUES (1, 1, datetime('now', '-2 hours'), 3, 'Tabs')",
    ).run()
    db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at, dosage, dosage_unit) VALUES (1, 1, datetime('now', '-1 hour'), 4, 'Tabs')",
    ).run()
    const maps = loadMedicationDoseState(db, [{ id: 1, date_of_birth: null }])
    expect(maps.total24hByPersonMed.get("1:1")).toBe(7)
  })

  it("keeps 24h totals form-local — a sibling group medication's doses don't count toward this medication's cap", () => {
    db.prepare("INSERT INTO medications (id, name, dosage_unit) VALUES (2, 'Paracetamol', 'Tabs')").run()
    db.prepare("INSERT INTO medication_groups (id, name) VALUES (1, 'Pain relief')").run()
    db.prepare("INSERT INTO medication_group_members (group_id, medication_id) VALUES (1, 1), (1, 2)").run()
    db.prepare(
      "INSERT INTO medication_frequency_rules (medication_id, min_hours_between, max_quantity_per_24h, max_per_24h_count_doses) VALUES (1, 4, 3, 1)",
    ).run()
    db.prepare("INSERT INTO person_medications (person_id, medication_id, is_active) VALUES (1, 2, 1)").run()
    db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES (1, 2, datetime('now', '-1 hour'))",
    ).run()
    const maps = loadMedicationDoseState(db, [{ id: 1, date_of_birth: null }])
    expect(maps.total24hByPersonMed.get("1:1")).toBe(0)
  })

  it("resolves lastDose across sibling group medications (bulk path)", () => {
    db.prepare("INSERT INTO medications (id, name, dosage_unit) VALUES (2, 'Paracetamol', 'Tabs')").run()
    db.prepare("INSERT INTO medication_groups (id, name) VALUES (1, 'Pain relief')").run()
    db.prepare("INSERT INTO medication_group_members (group_id, medication_id) VALUES (1, 1), (1, 2)").run()
    const iso = new Date(Date.now() - 90 * 60_000).toISOString()
    db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES (1, 2, ?)",
    ).run(iso)
    const maps = loadMedicationDoseState(db, [{ id: 1, date_of_birth: null }])
    expect(maps.lastDoseByPersonMed.get("1:1")?.lastIso).toBe(iso)
    expect(maps.lastDoseByPersonMed.get("1:1")?.lastMedName).toBe("Paracetamol")
  })

  it("falls back to a per-pair query for a lastDose older than the bulk lookback window", () => {
    const oldIso = new Date(Date.now() - 200 * 24 * 3_600_000).toISOString() // 200 days ago
    db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES (1, 1, ?)",
    ).run(oldIso)
    const maps = loadMedicationDoseState(db, [{ id: 1, date_of_birth: null }])
    expect(maps.lastDoseByPersonMed.get("1:1")?.lastIso).toBe(oldIso)
  })

  it("bulk-loads rules and dose state correctly across multiple people and medications", () => {
    db.prepare("INSERT INTO people (id, name) VALUES (2, 'Bob')").run()
    db.prepare("INSERT INTO medications (id, name, dosage_unit, default_dosage) VALUES (2, 'Ibuprofen', 'Tabs', 1)").run()
    db.prepare("INSERT INTO person_medications (person_id, medication_id, is_active) VALUES (2, 2, 1)").run()
    db.prepare("INSERT INTO medication_frequency_rules (medication_id, min_hours_between, max_quantity_per_24h, max_per_24h_count_doses) VALUES (1, 4, 3, 1)").run()
    db.prepare("INSERT INTO medication_frequency_rules (medication_id, min_hours_between, max_quantity_per_24h, max_per_24h_count_doses) VALUES (2, 6, 4, 1)").run()
    db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES (1, 1, datetime('now', '-1 hour'))",
    ).run()
    db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES (2, 2, datetime('now', '-1 hour'))",
    ).run()

    const maps = loadMedicationDoseState(db, [
      { id: 1, date_of_birth: null },
      { id: 2, date_of_birth: null },
    ])
    expect(maps.total24hByPersonMed.get("1:1")).toBe(1)
    expect(maps.total24hByPersonMed.get("2:2")).toBe(1)
    expect(maps.ruleByPersonMed.get("1:1")?.min_hours_between).toBe(4)
    expect(maps.ruleByPersonMed.get("2:2")?.min_hours_between).toBe(6)
    expect(maps.catalogDefaultDosageByMed.get(2)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// doseSliceFromMaps
// ---------------------------------------------------------------------------

describe("doseSliceFromMaps", () => {
  it("extracts slice from maps by personId:medId key", () => {
    const rule = baseRule()
    const maps = {
      ruleByPersonMed: new Map([["1:1", rule]]),
      total24hByPersonMed: new Map([["1:1", 2]]),
      lastDoseByPersonMed: new Map([["1:1", { lastIso: "2025-01-01T00:00:00.000Z", remindAfterHours: null, lastMedName: "Panadol" }]]),
      oldest24hByPersonMed: new Map([["1:1", "2025-01-01T00:00:00.000Z"]]),
      lastDosageByPersonMed: new Map([["1:1", 2]]),
      catalogDefaultDosageByMed: new Map([[1, 2]]),
    }
    const slice = doseSliceFromMaps(maps, 1, 1)
    expect(slice.rule).toBe(rule)
    expect(slice.total24h).toBe(2)
    expect(slice.lastDose?.lastMedName).toBe("Panadol")
    expect(slice.catalogDefaultDosage).toBe(2)
  })

  it("returns null/zero defaults for missing keys", () => {
    const maps = {
      ruleByPersonMed: new Map<string, FrequencyRule | null>(),
      total24hByPersonMed: new Map<string, number>(),
      lastDoseByPersonMed: new Map<string, { lastIso: string; remindAfterHours: number | null; lastMedName: string | null } | null>(),
      oldest24hByPersonMed: new Map<string, string | null>(),
      lastDosageByPersonMed: new Map<string, number | null>(),
      catalogDefaultDosageByMed: new Map<number, number | null>(),
    }
    const slice = doseSliceFromMaps(maps, 99, 99)
    expect(slice.rule).toBeNull()
    expect(slice.total24h).toBe(0)
    expect(slice.lastDose).toBeNull()
    expect(slice.catalogDefaultDosage).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// evaluatePrnState
// ---------------------------------------------------------------------------

// Reference now: 2025-01-15 12:00 UTC
const NOW = new Date("2025-01-15T12:00:00.000Z")
const HOUR = 3_600_000

describe("evaluatePrnState — no rule", () => {
  it("canDose with no flags when rule is null", () => {
    const ev = evaluatePrnState(emptySlice(), NOW)
    expect(ev).toEqual({
      atCap: false,
      coverageGap: false,
      cooldown: false,
      canDose: true,
      resetAtMs: null,
      availableAtMs: null,
      effectiveOffsetH: null,
    })
  })
})

describe("evaluatePrnState — cooldown", () => {
  it("cooldown when lastDose is within min interval", () => {
    const rule = baseRule({ min_hours_between: 4 })
    const lastIso = new Date(NOW.getTime() - 2 * HOUR).toISOString() // 2h ago
    const ev = evaluatePrnState(
      emptySlice({ rule, lastDose: { lastIso, remindAfterHours: null, lastMedName: null } }),
      NOW,
    )
    expect(ev.cooldown).toBe(true)
    expect(ev.canDose).toBe(false)
    expect(ev.effectiveOffsetH).toBe(4)
    expect(ev.availableAtMs).toBe(new Date(lastIso).getTime() + 4 * HOUR)
  })

  it("no cooldown when min interval has elapsed", () => {
    const rule = baseRule({ min_hours_between: 4 })
    const lastIso = new Date(NOW.getTime() - 5 * HOUR).toISOString() // 5h ago
    const ev = evaluatePrnState(
      emptySlice({ rule, lastDose: { lastIso, remindAfterHours: null, lastMedName: null } }),
      NOW,
    )
    expect(ev.cooldown).toBe(false)
    expect(ev.canDose).toBe(true)
    expect(ev.availableAtMs).toBe(new Date(lastIso).getTime() + 4 * HOUR)
  })

  it("uses remindAfterHours over min_hours_between for cooldown window", () => {
    const rule = baseRule({ min_hours_between: 4 })
    const lastIso = new Date(NOW.getTime() - 3 * HOUR).toISOString() // 3h ago
    // remind offset = 6h → still in cooldown even though min interval elapsed
    const ev = evaluatePrnState(
      emptySlice({ rule, lastDose: { lastIso, remindAfterHours: 6, lastMedName: null } }),
      NOW,
    )
    expect(ev.cooldown).toBe(true)
    expect(ev.effectiveOffsetH).toBe(6)
    expect(ev.availableAtMs).toBe(new Date(lastIso).getTime() + 6 * HOUR)
  })

  it("no cooldown when max_hours_between has elapsed (dose is too old)", () => {
    const rule = baseRule({ min_hours_between: 4, max_hours_between: 8 })
    const lastIso = new Date(NOW.getTime() - 10 * HOUR).toISOString() // 10h ago, past max
    const ev = evaluatePrnState(
      emptySlice({ rule, lastDose: { lastIso, remindAfterHours: null, lastMedName: null } }),
      NOW,
    )
    expect(ev.cooldown).toBe(false)
    // Timing still computed — display must gate on the cooldown flag
    expect(ev.availableAtMs).toBe(new Date(lastIso).getTime() + 4 * HOUR)
  })
})

describe("evaluatePrnState — timing always-on + cron readiness ≡ !cooldown", () => {
  it("resetAtMs from oldest24h even when not at cap", () => {
    const rule = baseRule({ min_hours_between: 4, max_quantity_per_24h: 4, max_per_24h_count_doses: 1 })
    const oldest = new Date(NOW.getTime() - 6 * HOUR).toISOString()
    const ev = evaluatePrnState(emptySlice({ rule, total24h: 1, oldest24h: oldest }), NOW)
    expect(ev.atCap).toBe(false)
    expect(ev.resetAtMs).toBe(new Date(oldest).getTime() + 24 * HOUR)
  })

  it("max_hours_between early clear: cooldown false while availableAtMs still future", () => {
    // remind offset 8h, max relevance 5h — at 6h since dose, past max but before available
    const rule = baseRule({ min_hours_between: 4, max_hours_between: 5 })
    const lastIso = new Date(NOW.getTime() - 6 * HOUR).toISOString()
    const ev = evaluatePrnState(
      emptySlice({ rule, lastDose: { lastIso, remindAfterHours: 8, lastMedName: null } }),
      NOW,
    )
    expect(ev.cooldown).toBe(false)
    expect(ev.canDose).toBe(true)
    expect(ev.availableAtMs).toBe(new Date(lastIso).getTime() + 8 * HOUR)
    expect(ev.availableAtMs!).toBeGreaterThan(NOW.getTime())
    // Cron readiness ≡ !cooldown (same as dashboard)
    expect(!ev.cooldown).toBe(true)
  })

  it("legacy remind_after below min: eval uses stored value (no Math.max clamp)", () => {
    const rule = baseRule({ min_hours_between: 4 })
    const lastIso = new Date(NOW.getTime() - 2 * HOUR).toISOString()
    const ev = evaluatePrnState(
      emptySlice({ rule, lastDose: { lastIso, remindAfterHours: 1, lastMedName: null } }),
      NOW,
    )
    // Old cron clamped to min=4 → still cooling; eval uses 1h → ready
    expect(ev.effectiveOffsetH).toBe(1)
    expect(ev.availableAtMs).toBe(new Date(lastIso).getTime() + 1 * HOUR)
    expect(ev.cooldown).toBe(false)
    expect(!ev.cooldown).toBe(true)
  })

  it("remind-after override: cron-ready only after effective offset", () => {
    const rule = baseRule({ min_hours_between: 4 })
    const lastIso = new Date(NOW.getTime() - 5 * HOUR).toISOString()
    const ev = evaluatePrnState(
      emptySlice({ rule, lastDose: { lastIso, remindAfterHours: 6, lastMedName: null } }),
      NOW,
    )
    expect(ev.cooldown).toBe(true)
    expect(!ev.cooldown).toBe(false)
  })
})

describe("evaluatePrnState — dose-count cap (max_per_24h_count_doses = 1)", () => {
  const rule = baseRule({ min_hours_between: 4, max_quantity_per_24h: 3, max_per_24h_count_doses: 1 })

  it("atCap when total24h >= max", () => {
    const ev = evaluatePrnState(emptySlice({ rule, total24h: 3 }), NOW)
    expect(ev.atCap).toBe(true)
    expect(ev.canDose).toBe(false)
  })

  it("not at cap when total24h < max", () => {
    const ev = evaluatePrnState(emptySlice({ rule, total24h: 2 }), NOW)
    expect(ev.atCap).toBe(false)
  })

  it("coverageGap at total24h === max - 1 (one dose remaining)", () => {
    const ev = evaluatePrnState(emptySlice({ rule, total24h: 2 }), NOW)
    expect(ev.coverageGap).toBe(true)
  })

  it("no coverageGap at total24h === 0 (plenty of doses left)", () => {
    const ev = evaluatePrnState(emptySlice({ rule, total24h: 0 }), NOW)
    expect(ev.coverageGap).toBe(false)
  })
})

describe("evaluatePrnState — quantity cap (max_per_24h_count_doses = 0)", () => {
  it("atCap when remaining < oneDoseUnit (using rule dosage)", () => {
    const rule = baseRule({ min_hours_between: 4, max_quantity_per_24h: 10, max_per_24h_count_doses: 0, dosage: 5 })
    // 9 taken; remaining = 1; 1 < 5 → at cap
    const ev = evaluatePrnState(emptySlice({ rule, total24h: 9 }), NOW)
    expect(ev.atCap).toBe(true)
  })

  it("atCap falls back to catalogDefaultDosage when rule dosage is null", () => {
    const rule = baseRule({ min_hours_between: 4, max_quantity_per_24h: 10, max_per_24h_count_doses: 0, dosage: null })
    // 9 taken; remaining = 1; catalogDefaultDosage = 5 → 1 < 5 → at cap
    const ev = evaluatePrnState(emptySlice({ rule, total24h: 9, catalogDefaultDosage: 5 }), NOW)
    expect(ev.atCap).toBe(true)
  })

  it("atCap falls back to lastDosage when rule and catalogue dosage are null", () => {
    const rule = baseRule({ min_hours_between: 4, max_quantity_per_24h: 10, max_per_24h_count_doses: 0, dosage: null })
    const ev = evaluatePrnState(emptySlice({ rule, total24h: 9, catalogDefaultDosage: null, lastDosage: 5 }), NOW)
    expect(ev.atCap).toBe(true)
  })

  it("atCap by raw total when no dose unit available", () => {
    const rule = baseRule({ min_hours_between: 4, max_quantity_per_24h: 10, max_per_24h_count_doses: 0, dosage: null })
    const ev = evaluatePrnState(emptySlice({ rule, total24h: 10, catalogDefaultDosage: null, lastDosage: null }), NOW)
    expect(ev.atCap).toBe(true)
  })

  it("coverageGap when remaining < 2 * oneDoseUnit", () => {
    const rule = baseRule({ min_hours_between: 4, max_quantity_per_24h: 10, max_per_24h_count_doses: 0, dosage: 4 })
    // 3 taken; remaining = 7; 7 < 2 * 4 = 8 → coverage gap
    const ev = evaluatePrnState(emptySlice({ rule, total24h: 3 }), NOW)
    expect(ev.coverageGap).toBe(true)
    expect(ev.atCap).toBe(false)
  })
})

describe("evaluatePrnState — canDose", () => {
  it("canDose is false when atCap", () => {
    const rule = baseRule({ min_hours_between: 4, max_quantity_per_24h: 3, max_per_24h_count_doses: 1 })
    const ev = evaluatePrnState(emptySlice({ rule, total24h: 3 }), NOW)
    expect(ev.canDose).toBe(false)
  })

  it("canDose is false when in cooldown", () => {
    const rule = baseRule({ min_hours_between: 4 })
    const lastIso = new Date(NOW.getTime() - 2 * HOUR).toISOString()
    const ev = evaluatePrnState(
      emptySlice({ rule, lastDose: { lastIso, remindAfterHours: null, lastMedName: null } }),
      NOW,
    )
    expect(ev.canDose).toBe(false)
  })

  it("canDose is true when neither at cap nor in cooldown", () => {
    const rule = baseRule({ min_hours_between: 4, max_quantity_per_24h: 3, max_per_24h_count_doses: 1 })
    const lastIso = new Date(NOW.getTime() - 5 * HOUR).toISOString()
    const ev = evaluatePrnState(
      emptySlice({ rule, total24h: 1, lastDose: { lastIso, remindAfterHours: null, lastMedName: null } }),
      NOW,
    )
    expect(ev.canDose).toBe(true)
  })
})
