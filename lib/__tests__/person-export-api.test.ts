// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { execFileSync } from "child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import v8 from "v8"
import vm from "vm"
import { applyBaselineSchema } from "@/lib/db"
import { __setUploadBlobAdapterForTests, createMemoryUploadBlobAdapter, deleteUpload } from "@/lib/uploads/store"
import type { PersonExportPayload } from "@/lib/person/person-export"
import type { ExportManifest } from "@/lib/export/export-manifest"
import { exportsInFlight } from "@/lib/export/export-registry"
import { seedExportHousehold } from "./helpers/export-fixture"

vi.mock("@/lib/db", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}))

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => session),
}))

let testDb: Database.Database
let session: { user: { id: string; email: string }; sessionVersion: number } | null

const APP_VERSION = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).version as string

function signInAs(accountId: number, email: string) {
  session = { user: { id: `local:${accountId}`, email }, sessionVersion: 0 }
}

const responses: Response[] = []

async function exportPerson(personId: number) {
  const { GET } = await import("@/app/api/people/[id]/export/route")
  const res = await GET(new NextRequest(`http://localhost/api/people/${personId}/export`), {
    params: Promise.resolve({ id: String(personId) }),
  })
  responses.push(res)
  return res
}

/** Abandons any download a test left unread, as a client that went away would. */
async function abandonUnreadDownloads() {
  for (const res of responses.splice(0)) {
    if (res.body && !res.body.locked) await res.body.cancel()
  }
}

interface ZipEntryInfo { name: string; method: string }

class ExportZip {
  constructor(private readonly path: string) {}

  /** Entry names and compression methods, in archive order. */
  entries(): ZipEntryInfo[] {
    return execFileSync("unzip", ["-Z", this.path], { encoding: "utf8" })
      .split("\n")
      .filter(line => /^[-d]/.test(line))
      .map(line => {
        const cols = line.trim().split(/\s+/)
        return { method: cols[5], name: cols.slice(8).join(" ") }
      })
  }

  names(): string[] {
    return this.entries().map(e => e.name)
  }

  text(name: string): string {
    return execFileSync("unzip", ["-p", this.path, name], { encoding: "utf8" })
  }

  json<T = Record<string, unknown>>(name: string): T {
    return JSON.parse(this.text(name)) as T
  }
}

async function readZip(res: Response): Promise<ExportZip> {
  const dir = mkdtempSync(join(tmpdir(), "fc-person-export-"))
  const path = join(dir, "export.zip")
  writeFileSync(path, Buffer.from(await res.arrayBuffer()))
  return new ExportZip(path)
}

describe("GET /api/people/[id]/export", () => {
  beforeEach(async () => {
    testDb = new Database(":memory:")
    applyBaselineSchema(testDb)
    __setUploadBlobAdapterForTests(createMemoryUploadBlobAdapter())
    await seedExportHousehold(testDb)
    signInAs(1, "admin@example.com")
  })

  afterEach(async () => {
    await abandonUnreadDownloads()
    testDb.close()
    __setUploadBlobAdapterForTests(null)
    vi.clearAllMocks()
  })

  it("puts the manifest first, naming the scope, format version, app version and skipped files", async () => {
    const res = await exportPerson(1)
    expect(res.status).toBe(200)
    const zip = await readZip(res)
    expect(zip.names()[0]).toBe("manifest.json")
    expect(zip.json("manifest.json")).toMatchObject({
      format_version: 2,
      scope: "person",
      app_version: APP_VERSION,
      skipped_files: [],
    })
  })

  it("lists the sections present with their record counts", async () => {
    const manifest = (await readZip(await exportPerson(1))).json<ExportManifest>("manifest.json")
    expect(manifest.sections).toEqual([
      "person", "medications", "assignments", "administrations", "observations", "test_results", "symptoms",
      "symptom_dose_links", "observation_goals", "observation_expectations", "slot_outcomes", "catalogues", "user_settings",
    ])
    expect(manifest.counts).toEqual({
      person: 1, medications: 2, assignments: 2, administrations: 2, observations: 4, test_results: 1, symptoms: 1,
      symptom_dose_links: 1, observation_goals: 1, observation_expectations: 1, slot_outcomes: 2, attachments: 2,
    })
  })

  it("carries slot outcomes by bundle-local assignment and dose ids, with no database ids to restore from", async () => {
    const payload = (await readZip(await exportPerson(1))).json<{
      assignments: { id: number; medication_id: number }[]
      administrations: { id: number; recorded_at: string }[]
      slot_outcomes: Record<string, unknown>[]
    }>("person.json")
    const dose = payload.administrations.find(row => row.recorded_at === "2026-02-01T08:00:00.000Z")!
    expect(payload.slot_outcomes).toEqual([
      {
        assignment_id: payload.assignments[0].id, local_ymd: "2026-02-01", slot_hhmm: "08:00", result: "on_time",
        offset_minutes: 0, missed_cause: null, administration_id: dose.id, created_at: expect.any(String),
      },
      {
        assignment_id: payload.assignments[0].id, local_ymd: "2026-02-03", slot_hhmm: "08:00", result: "missed",
        offset_minutes: null, missed_cause: "timed_out", administration_id: null, created_at: expect.any(String),
      },
    ])
  })

  it("names entries by bundle-local names only, never the Person or a stored file name", async () => {
    const names = (await readZip(await exportPerson(1))).names()
    expect(names).toEqual([
      "manifest.json",
      "person.json",
      "csv/administrations.csv",
      "csv/observations.csv",
      "csv/test_results.csv",
      "csv/symptoms.csv",
      "csv/symptom_dose_links.csv",
      "attachments/photo.jpg",
      "attachments/report-1.pdf",
    ])
  })

  it("includes readable CSV copies of the records by name, pointing at the bundled report", async () => {
    const zip = await readZip(await exportPerson(1))
    expect(zip.text("csv/administrations.csv")).toBe(
      "recorded_at,medication_name,dosage,dosage_unit,comments,administered_by\r\n" +
      "2026-02-01T08:00:00.000Z,Paracetamol,250,mg,After breakfast,me\r\n" +
      "2026-02-01T14:00:00.000Z,Ibuprofen,200,mg,,away_from_home\r\n",
    )
    expect(zip.text("csv/test_results.csv").split("\r\n")[1]).toBe(
      "2026-01-15,Iron studies,Blood,Dr Smith,Fasting,report-1.pdf,Ferritin,numeric,,30,,ug/L,20 - 200,",
    )
    expect(zip.json<PersonExportPayload>("person.json").test_results[0].report).toEqual({
      file: "attachments/report-1.pdf", original_name: "88888888-8888-4888-8888-888888888888.pdf",
    })
    expect(zip.text("attachments/report-1.pdf")).toBe("iron-pdf-bytes")
  })

  it("exports an inactive Person", async () => {
    const res = await exportPerson(3)
    expect(res.status).toBe(200)
    expect((await readZip(res)).json<PersonExportPayload>("person.json").person).toMatchObject({ name: "Robin", is_active: 0 })
  })

  it("lists a missing report in the manifest instead of silently leaving it out", async () => {
    await deleteUpload("test-results", "88888888-8888-4888-8888-888888888888.pdf")
    const zip = await readZip(await exportPerson(1))
    expect(zip.json<ExportManifest>("manifest.json").skipped_files).toEqual([
      { path: "attachments/report-1.pdf", reason: "The report file is missing from storage" },
    ])
    expect(zip.names()).not.toContain("attachments/report-1.pdf")
    expect(zip.json<PersonExportPayload>("person.json").test_results[0].report).toEqual({ file: null, original_name: "88888888-8888-4888-8888-888888888888.pdf" })
  })

  it("stores photos and reports as they are and compresses the structured data", async () => {
    const entries = (await readZip(await exportPerson(1))).entries()
    const attachments = entries.filter(e => e.name.startsWith("attachments/"))
    expect(attachments).toHaveLength(2)
    expect(attachments.every(e => e.method === "stor")).toBe(true)
    expect(entries.find(e => e.name === "manifest.json")?.method).toBe("defN")
  })

  describe("who may export", () => {
    it("lets an Admin export any Person", async () => {
      for (const personId of [1, 2, 3]) expect((await exportPerson(personId)).status).toBe(200)
    })

    it("lets a None-role Account with a Personal-link export its own Person and nobody else", async () => {
      signInAs(2, "sam@example.com")
      const own = await exportPerson(2)
      expect(own.status).toBe(200)
      expect((await readZip(own)).json<PersonExportPayload>("person.json").person.name).toBe("Sam")
      expect((await exportPerson(1)).status).toBe(404)
    })

    it("lets a Household Role holder with a Personal-link export only their own Person", async () => {
      testDb.exec("UPDATE people SET account_uid = 'local:4' WHERE id = 1")
      signInAs(4, "writer@example.com")
      expect((await exportPerson(1)).status).toBe(200)
      expect((await exportPerson(2)).status).toBe(404)
    })

    it("refuses a Manager or ReadWrite Account without a Personal-link", async () => {
      signInAs(3, "manager@example.com")
      expect((await exportPerson(1)).status).toBe(404)
      signInAs(4, "writer@example.com")
      expect((await exportPerson(1)).status).toBe(404)
    })

    it("refuses a None-role Account without a Personal-link", async () => {
      signInAs(5, "unlinked@example.com")
      expect((await exportPerson(2)).status).toBe(404)
    })

    it("refuses an anonymous request", async () => {
      session = null
      expect((await exportPerson(1)).status).toBe(401)
    })
  })

  it("records every export in the audit log with the actor, scope, Person, counts and format version", async () => {
    signInAs(2, "sam@example.com")
    await (await exportPerson(2)).arrayBuffer()
    const rows = testDb.prepare("SELECT user_email, action, entity_type, entity_id, details FROM audit_log").all() as {
      user_email: string; action: string; entity_type: string; entity_id: number; details: string
    }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ user_email: "sam@example.com", action: "EXPORT", entity_type: "people", entity_id: 2 })
    expect(JSON.parse(rows[0].details)).toEqual({
      scope: "person",
      format_version: 2,
      counts: {
        person: 1, medications: 1, assignments: 1, administrations: 1, observations: 1, test_results: 0, symptoms: 0,
        symptom_dose_links: 0, observation_goals: 0, observation_expectations: 0, slot_outcomes: 1, attachments: 0,
      },
    })
  })

  describe("exports in flight", () => {
    it("counts an export as in flight until its download finishes", async () => {
      const res = await exportPerson(1)
      expect(exportsInFlight(1)).toBe(1)
      expect(exportsInFlight(2)).toBe(0)
      await res.arrayBuffer()
      expect(exportsInFlight(1)).toBe(0)
    })

    it("counts concurrent exports of one Person separately", async () => {
      const first = await exportPerson(1)
      const second = await exportPerson(1)
      expect(exportsInFlight(1)).toBe(2)
      await first.arrayBuffer()
      expect(exportsInFlight(1)).toBe(1)
      await second.arrayBuffer()
      expect(exportsInFlight(1)).toBe(0)
    })

    it("releases an export whose download is abandoned part-way", async () => {
      const res = await exportPerson(1)
      const reader = res.body!.getReader()
      await reader.read()
      await reader.cancel()
      expect(exportsInFlight(1)).toBe(0)
    })
  })

  async function payload(personId = 1): Promise<PersonExportPayload> {
    return (await readZip(await exportPerson(personId))).json<PersonExportPayload>("person.json")
  }

  it("carries only that Person's own settings, with no email, Account uid or anyone else's preferences", async () => {
    testDb.exec(`
      INSERT INTO user_settings (user_uid, key, value, updated_at) VALUES
        ('local:2', 'locale.timezone', 'Australia/Adelaide', 1),
        ('local:2', 'hydration.active_start', '08:30', 1),
        ('local:2', 'hydration.glass_size', '300', 1),
        ('local:2', 'hydration.muted_until', 'mute-marker-person', 1),
        ('local:1', 'locale.timezone', 'Europe/London', 1);
      INSERT INTO person_notification_prefs
        (person_id, user_uid, notify_prn, notify_prescribed, notify_overdue, notify_observations, notify_hydration)
        VALUES
          (2, 'local:2', 0, 1, 1, 1, 0),
          (1, 'local:2', 1, 1, 1, 0, 1),
          (2, 'local:1', 1, 0, 1, 1, 1);
      INSERT INTO push_endpoints (user_uid, endpoint, p256dh, web_push_auth)
        VALUES ('local:2', 'https://push.example.invalid/person', 'push-p256dh-person', 'push-auth-person');
    `)
    const section = (await payload(2)).user_settings
    expect(section).toEqual({
      person_id: 1,
      timezone: "Australia/Adelaide",
      hydration: { active_start: "08:30", glass_size: "300" },
      notifications: {
        notify_prn: false,
        notify_prescribed: true,
        notify_overdue: true,
        notify_observations: true,
        notify_hydration: false,
      },
    })
    const text = JSON.stringify(section)
    expect(text).not.toContain("@")
    expect(text).not.toContain("local:")
    expect(text).not.toContain("Europe/London")
    expect(text).not.toContain("mute-marker-person")
    expect(text).not.toContain("push-p256dh-person")
  })

  it("carries the Person and their history, cross-referenced by bundle-local ids", async () => {
    const p = await payload()
    expect(p.person).toMatchObject({
      id: 1, db_id: 1, name: "Alex", full_name: "Alex Example", date_of_birth: "2015-04-02", color: "#AA3311", is_active: 1,
    })

    const medicationName = (id: number) => p.medications.find(m => m.id === id)?.name
    expect(p.administrations.map(a => ({
      medication: medicationName(a.medication_id), recorded_at: a.recorded_at, dosage: a.dosage, dosage_unit: a.dosage_unit,
      comments: a.comments, administered_by: a.administered_by, created_by: a.created_by,
    }))).toEqual([
      {
        medication: "Paracetamol", recorded_at: "2026-02-01T08:00:00.000Z", dosage: 250, dosage_unit: "mg",
        comments: "After breakfast", administered_by: "me", created_by: "admin@example.com",
      },
      {
        medication: "Ibuprofen", recorded_at: "2026-02-01T14:00:00.000Z", dosage: 200, dosage_unit: "mg",
        comments: null, administered_by: "away_from_home", created_by: "writer@example.com",
      },
    ])

    const bloodPressure = p.observations.filter(o => o.observation_type === "Blood Pressure")
    expect(bloodPressure.map(o => [o.value, o.unit, o.value_label])).toEqual([[105, "mmHg", "systolic"], [68, "mmHg", "diastolic"]])
    expect(bloodPressure[0].group_id).toEqual(expect.any(Number))
    expect(bloodPressure[1].group_id).toBe(bloodPressure[0].group_id)
    expect(p.observations.find(o => o.observation_type === "Weight")).toMatchObject({
      value: 21.5, unit: "kg", recorded_at: "2026-02-01T09:00:00.000Z", comments: "Shoes off", group_id: null,
    })
    expect(p.observations).toHaveLength(4)

    expect(p.test_results).toHaveLength(1)
    expect(p.test_results[0]).toMatchObject({
      name: "Iron studies", test_type: "Blood", date: "2026-01-15", ordered_by: "Dr Smith", notes: "Fasting",
    })
    expect(p.test_results[0].values).toEqual([
      { metric_name: "Ferritin", value_type: "numeric", numeric_value: 30, qualitative_value: null, unit: "ug/L", reference_range: "20 - 200", flag: null, limit_qualifier: null },
      { metric_name: "Iron", value_type: "numeric", numeric_value: 5, qualitative_value: null, unit: "umol/L", reference_range: null, flag: "differs from expected", limit_qualifier: "<" },
      { metric_name: "Coeliac screen", value_type: "qualitative", numeric_value: null, qualitative_value: "Negative", unit: null, reference_range: null, flag: null, limit_qualifier: null },
    ])

    expect(p.symptoms).toHaveLength(1)
    expect(p.symptoms[0]).toMatchObject({
      label: "Headache", start_date: "2026-01-31T13:30:00.000Z", end_date: "2026-02-01T13:30:00.000Z", severity: 2,
      is_resolved: 1, resolved_at: "2026-02-01T12:00:00.000Z", notes: "After school",
    })
    expect(p.symptom_dose_links).toHaveLength(1)
    const [link] = p.symptom_dose_links
    expect(p.symptoms.find(s => s.id === link.symptom_id)?.label).toBe("Headache")
    expect(p.administrations.find(a => a.id === link.administration_id)?.recorded_at).toBe("2026-02-01T08:00:00.000Z")
  })

  it("carries the configuration the Person uses, and only that", async () => {
    const p = await payload()

    expect(p.medications.map(({ id: _id, ...m }) => m)).toEqual([
      {
        db_id: 11, name: "Ibuprofen", default_dosage: 200, dosage_unit: "mg", min_age_years: 6, max_age_years: 65, notes: null, is_active: 0,
        frequency_rules: [{
          min_hours_between: 6, max_hours_between: 8, max_quantity_per_24h: 3, max_quantity_unit: "doses", min_age_years: null,
          max_age_years: null, dosage: null, min_weight_kg: null, max_weight_kg: null, max_per_24h_count_doses: 1,
        }],
      },
      {
        db_id: 10, name: "Paracetamol", default_dosage: 250, dosage_unit: "mg", min_age_years: 2, max_age_years: null, notes: "With food", is_active: 1,
        frequency_rules: [{
          min_hours_between: 4, max_hours_between: null, max_quantity_per_24h: 1000, max_quantity_unit: "mg", min_age_years: 2,
          max_age_years: null, dosage: null, min_weight_kg: null, max_weight_kg: null, max_per_24h_count_doses: 0,
        }],
      },
    ])

    const medicationName = (id: number) => p.medications.find(m => m.id === id)?.name
    const paracetamol = p.assignments.find(a => medicationName(a.medication_id) === "Paracetamol")!
    expect(paracetamol).toMatchObject({
      is_active: 1, schedule_times: '["08:00"]', schedule_frequency: "daily", schedule_start_date: "2026-01-01",
      schedule_end_date: null, schedule_slots: null, schedule_tz: "Europe/London",
      schedule_created_at_ms: 1767268800000,
    })
    expect(p.assignments.find(a => medicationName(a.medication_id) === "Ibuprofen")).toMatchObject({ is_active: 0, dose_expectations: [] })

    expect(paracetamol.dose_expectations).toHaveLength(1)
    const [expectation] = paracetamol.dose_expectations
    expect(expectation).toMatchObject({
      slot_hhmm: "08:00", start_date: "2026-01-01", end_date: "2026-12-31", weekdays: "1,2,3,4,5", created_by: "admin@example.com",
      exceptions: ["2026-02-02"],
    })
    expect(expectation.outcomes.map(({ administration_id, ...o }) => ({
      ...o, administration: p.administrations.find(a => a.id === administration_id)?.recorded_at ?? null,
    }))).toEqual([
      {
        local_ymd: "2026-02-01", status: "confirmed_given", snoozed_until: null, slot_at: "2026-02-01T08:00:00.000Z",
        resolved_by: "admin@example.com", resolved_at: "2026-02-01T08:01:00.000Z", administration: "2026-02-01T08:00:00.000Z",
      },
      {
        local_ymd: "2026-02-03", status: "confirmed_missed", snoozed_until: null, slot_at: "2026-02-03T08:00:00.000Z",
        resolved_by: "admin@example.com", resolved_at: "2026-02-03T10:00:00.000Z", administration: null,
      },
    ])

    expect(p.observation_goals).toEqual([
      { observation_type: "Hydration", goal_type: "daily_min", target_value: 1200, target_max: null, unit: "mL", is_active: 1, target_date: null },
    ])
    expect(p.observation_expectations).toEqual([{
      observation_type: "Weight", cadence: "custom_days", interval_days: 30, recurrence_day_of_month: null, recurrence_month: null,
      recurrence_day: null, recurrence_use_birthday: 0, enabled: 1, due_time_hhmm: "09:00", tz: "Europe/London",
    }])
  })

  it("lists the curated catalogues by name and on/off flag only", async () => {
    const { catalogues } = await payload()
    expect(catalogues.observation_types).toContainEqual({ name: "Head Circumference", is_active: 0 })
    expect(catalogues.observation_types).toContainEqual({ name: "Weight", is_active: 1 })
    expect(catalogues.test_metrics).toEqual([{ name: "Ferritin", is_active: 1 }, { name: "Iron", is_active: 0 }])
  })

  it("streams a large export without holding it in memory", async () => {
    const REPORTS = 40
    const REPORT_BYTES = 8 * 1024 * 1024
    // Reports are generated on read so the fixture itself holds no memory.
    __setUploadBlobAdapterForTests({
      ...createMemoryUploadBlobAdapter(),
      get: async (bucket, filename) => (bucket === "test-results" ? Buffer.alloc(REPORT_BYTES, filename) : null),
      head: async (bucket, filename, n) => (bucket === "test-results" ? Buffer.alloc(n, filename) : null),
    })
    const insert = testDb.prepare(
      "INSERT INTO test_events (person_id, test_type, name, date, attachment_url) VALUES (1, 'Blood', ?, '2026-01-01', ?)",
    )
    for (let i = 0; i < REPORTS; i++) insert.run(`Result ${i}`, `/api/test-results/uploads/00000000-0000-4000-8000-${String(i).padStart(12, "0")}.pdf`)

    // Collect garbage before each sample so the figure is what the export retains, not what is
    // waiting to be collected.
    v8.setFlagsFromString("--expose-gc")
    const gc = vm.runInNewContext("gc") as () => void
    const retained = () => {
      gc()
      return process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers
    }
    const baseline = retained()
    let peak = baseline
    const res = await exportPerson(1)
    peak = Math.max(peak, retained())
    const reader = res.body!.getReader()
    let total = 0
    let nextSample = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total >= nextSample) {
        peak = Math.max(peak, retained())
        nextSample += 4 * 1024 * 1024
      }
    }
    expect(total).toBeGreaterThan(REPORTS * REPORT_BYTES)
    // A few working copies of one report, never the whole export.
    expect(peak - baseline).toBeLessThan(8 * REPORT_BYTES)
  }, 60_000)
})
