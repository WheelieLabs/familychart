// SPDX-License-Identifier: AGPL-3.0-only

import { ZipArchive } from "archiver"
import { mkdtempSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Writable } from "stream"
import { seedExportHousehold } from "./helpers/export-fixture"
import { syncTestMetricCatalogue } from "@/lib/test-results/test-metric-catalogue"
import { __setUploadBlobAdapterForTests, createMemoryUploadBlobAdapter, readUpload } from "@/lib/uploads/store"
import { ZipFile } from "@/lib/restore/zip-file"

vi.mock("@/lib/db", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}))

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => session),
}))

let emailConfigured = true
let sendOutboundEmailCalls = 0
const sentMails: { to: string; text: string }[] = []
vi.mock("@/lib/email-send", () => ({
  isOutboundEmailConfigured: vi.fn(() => emailConfigured),
  sendOutboundEmail: vi.fn(async (_db: unknown, mail: { to: string; text: string }) => {
    sendOutboundEmailCalls += 1
    sentMails.push({ to: mail.to, text: mail.text })
    return { ok: true as const }
  }),
}))

import Database from "better-sqlite3-multiple-ciphers"
import { applyBaselineSchema } from "@/lib/db"
import { __setRestoreStageDirForTests } from "@/lib/restore/stage-store"
import {
  SETTING_EMAIL_SMTP_HOST,
  SETTING_EMAIL_SMTP_PASSWORD,
  SETTING_EMAIL_SMTP_PORT,
  SETTING_EMAIL_SMTP_TLS,
} from "@/lib/settings/registry"
import { ACCOUNTS_SKIPPED_NO_EMAIL, ARCHIVE_STRUCTURE_INVALID, ENTRY_TOO_LARGE } from "@/lib/restore/messages"
import { getSetupWizardContext, isSetupComplete } from "@/lib/setup-gate"

let testDb: Database.Database
let session: { user: { id: string; email: string }; sessionVersion: number } | null

function zipEntries(entries: { name: string; content: string }[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } })
    const chunks: Buffer[] = []
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk))
        cb()
      },
    })
    archive.on("error", reject)
    sink.on("error", reject)
    sink.on("finish", () => resolve(Buffer.concat(chunks)))
    archive.pipe(sink)
    for (const entry of entries) archive.append(entry.content, { name: entry.name })
    void archive.finalize()
  })
}

async function stage(bytes: Buffer) {
  const { POST } = await import("@/app/api/restore/upload/route")
  return POST(new NextRequest("http://localhost/api/restore/upload", {
    method: "POST",
    body: new Uint8Array(bytes),
    headers: { "content-type": "application/zip" },
  }))
}

function signInAsAdmin() {
  session = { user: { id: "local:1", email: "admin@example.com" }, sessionVersion: 0 }
}

function insertAdmin() {
  testDb.prepare("INSERT INTO accounts (id, email, role) VALUES (1, 'admin@example.com', 'admin')").run()
}

function seedSmtpSettings() {
  const now = Date.now()
  testDb.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
    SETTING_EMAIL_SMTP_HOST, "smtp.example.com", now,
  )
  testDb.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
    SETTING_EMAIL_SMTP_PORT, "587", now,
  )
  testDb.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
    SETTING_EMAIL_SMTP_TLS, "true", now,
  )
  testDb.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
    SETTING_EMAIL_SMTP_PASSWORD, "secret", now,
  )
}

describe("POST /api/restore/upload", () => {
  beforeEach(() => {
    testDb = new Database(":memory:")
    applyBaselineSchema(testDb)
    insertAdmin()
    signInAsAdmin()
    __setRestoreStageDirForTests(null)
  })

  afterEach(() => {
    testDb.close()
  })

  it("refuses a tiny end-of-directory file that declares a huge directory, and an oversized manifest", async () => {
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(1, 10)
    eocd.writeUInt32LE(0xfffffff0, 12)
    const tiny = await stage(eocd)
    expect(tiny.status).toBe(400)
    expect(await tiny.json()).toEqual({ error: ARCHIVE_STRUCTURE_INVALID })

    const huge = await stage(await zipEntries([{ name: "manifest.json", content: " ".repeat(2 * 1024 * 1024) }]))
    expect(huge.status).toBe(400)
    expect(await huge.json()).toEqual({ error: ENTRY_TOO_LARGE })
  })

  it("refuses an export with no manifest", async () => {
    const res = await stage(await zipEntries([{ name: "person.json", content: "{}" }]))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: "this export predates restore support; export again from an updated FamilyChart",
    })
  })

  it("refuses an export from a newer FamilyChart, naming the version that made it", async () => {
    const res = await stage(await zipEntries([{
      name: "manifest.json",
      content: JSON.stringify({
        format_version: 3,
        scope: "person",
        app_version: "9.9.9",
        exported_at: "2026-01-01T00:00:00.000Z",
        sections: [],
        counts: {},
        skipped_files: [],
      }),
    }]))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: "this export comes from a newer FamilyChart (version 9.9.9); update before importing",
    })
  })

  it("is admin-only and blocked in demo mode", async () => {
    const bytes = await zipEntries([{ name: "person.json", content: "{}" }])
    session = null
    const anonymous = await stage(bytes)
    expect(anonymous.status).toBe(401)
    expect(await anonymous.json()).toEqual({ error: "Unauthorised" })

    testDb.prepare("INSERT INTO accounts (id, email, role) VALUES (3, 'manager@example.com', 'manage')").run()
    session = { user: { id: "local:3", email: "manager@example.com" }, sessionVersion: 0 }
    const manager = await stage(bytes)
    expect(manager.status).toBe(403)
    expect(await manager.json()).toEqual({ error: "Forbidden" })

    signInAsAdmin()
    const previousDemo = process.env.DEMO_MODE
    const previousProfile = process.env.FC_PLATFORM_PROFILE
    process.env.DEMO_MODE = "true"
    process.env.FC_PLATFORM_PROFILE = "demo"
    try {
      const demo = await stage(bytes)
      expect(demo.status).toBe(403)
      expect(await demo.json()).toEqual({ error: "This is a demo environment — restore is disabled." })
    } finally {
      if (previousDemo === undefined) delete process.env.DEMO_MODE
      else process.env.DEMO_MODE = previousDemo
      if (previousProfile === undefined) delete process.env.FC_PLATFORM_PROFILE
      else process.env.FC_PLATFORM_PROFILE = previousProfile
    }
  })

  it("refuses an upload over FC_RESTORE_MAX_UPLOAD_MB", async () => {
    const previous = process.env.FC_RESTORE_MAX_UPLOAD_MB
    process.env.FC_RESTORE_MAX_UPLOAD_MB = "1"
    try {
      const res = await stage(Buffer.alloc(1024 * 1024 + 1))
      expect(res.status).toBe(413)
      expect(await res.json()).toEqual({ error: "Upload exceeds the restore limit of 1 MB" })
    } finally {
      if (previous === undefined) delete process.env.FC_RESTORE_MAX_UPLOAD_MB
      else process.env.FC_RESTORE_MAX_UPLOAD_MB = previous
    }
  })
})

describe("GET /api/restore/[id]", () => {
  let stageDir: string

  beforeEach(async () => {
    stageDir = mkdtempSync(join(tmpdir(), "fc-restore-"))
    __setRestoreStageDirForTests(stageDir)
    __setUploadBlobAdapterForTests(createMemoryUploadBlobAdapter())
    testDb = new Database(":memory:")
    applyBaselineSchema(testDb)
    await seedExportHousehold(testDb)
    signInAsAdmin()
  })

  afterEach(() => {
    testDb.close()
    __setUploadBlobAdapterForTests(null)
    __setRestoreStageDirForTests(null)
  })

  async function exportAlex(): Promise<Buffer> {
    const { GET } = await import("@/app/api/people/[id]/export/route")
    const res = await GET(new NextRequest("http://localhost/api/people/1/export"), {
      params: Promise.resolve({ id: "1" }),
    })
    return Buffer.from(await res.arrayBuffer())
  }

  async function planFor(bytes: Buffer) {
    const staged = await stage(bytes)
    expect(staged.status).toBe(200)
    const { id } = await staged.json() as { id: string }
    const { GET } = await import("@/app/api/restore/[id]/route")
    return GET(new NextRequest(`http://localhost/api/restore/${id}`), {
      params: Promise.resolve({ id }),
    })
  }

  it("pre-selects an exact name and date-of-birth match and maps a medication by name", async () => {
    const zip = await exportAlex()
    testDb.close()
    testDb = new Database(":memory:")
    applyBaselineSchema(testDb)
    insertAdmin()
    testDb.exec(`
      INSERT INTO people (id, name, date_of_birth, color) VALUES (7, 'Alex', '2015-04-02', '#256AA5');
      INSERT INTO medications (id, name, dosage_unit) VALUES (4, 'paracetamol', 'mg');
    `)
    const res = await planFor(zip)
    expect(res.status).toBe(200)
    const plan = await res.json()
    expect(plan.persons).toEqual([
      { bundle_id: 1, name: "Alex", date_of_birth: "2015-04-02", suggested_action: "map", target_id: 7 },
    ])
    expect(plan.medications).toContainEqual({
      bundle_id: expect.any(Number), name: "Paracetamol", suggested_action: "map", target_id: 4,
    })
    expect(plan.medications).toContainEqual({
      bundle_id: expect.any(Number), name: "Ibuprofen", suggested_action: "new", target_id: null,
    })
    expect(plan.accounts).toBe("not restored")
    expect(plan.favourites).toBe("not restored")
    expect(plan.settings).toBe("not restored")
  })

  it("warns when a name matches but the date of birth does not", async () => {
    const zip = await exportAlex()
    testDb.close()
    testDb = new Database(":memory:")
    applyBaselineSchema(testDb)
    insertAdmin()
    testDb.prepare("INSERT INTO people (id, name, date_of_birth) VALUES (7, 'Alex', '2000-01-01')").run()
    const res = await planFor(zip)
    expect(res.status).toBe(200)
    const plan = await res.json()
    expect(plan.persons[0]).toMatchObject({ suggested_action: "new", target_id: null })
    expect(plan.warnings).toContainEqual({
      kind: "date_of_birth_mismatch",
      name: "Alex",
      export_date_of_birth: "2015-04-02",
      existing_date_of_birth: "2000-01-01",
      existing_id: 7,
    })
  })
})

describe("POST /api/restore/[id]/apply", () => {
  let stageDir: string

  beforeEach(async () => {
    emailConfigured = true
    sendOutboundEmailCalls = 0
    sentMails.length = 0
    stageDir = mkdtempSync(join(tmpdir(), "fc-restore-"))
    __setRestoreStageDirForTests(stageDir)
    __setUploadBlobAdapterForTests(createMemoryUploadBlobAdapter())
    testDb = new Database(":memory:")
    applyBaselineSchema(testDb)
    await seedExportHousehold(testDb)
    signInAsAdmin()
  })

  afterEach(() => {
    testDb.close()
    __setUploadBlobAdapterForTests(null)
    __setRestoreStageDirForTests(null)
  })

  async function exportPerson(personId: number): Promise<Buffer> {
    const { GET } = await import("@/app/api/people/[id]/export/route")
    const res = await GET(new NextRequest(`http://localhost/api/people/${personId}/export`), {
      params: Promise.resolve({ id: String(personId) }),
    })
    expect(res.status).toBe(200)
    return Buffer.from(await res.arrayBuffer())
  }

  async function exportHousehold(): Promise<Buffer> {
    const { GET } = await import("@/app/api/export/household/route")
    const res = await GET(new NextRequest("http://localhost/api/export/household"))
    expect(res.status).toBe(200)
    return Buffer.from(await res.arrayBuffer())
  }

  async function stageAndPlan(bytes: Buffer) {
    const staged = await stage(bytes)
    expect(staged.status).toBe(200)
    const { id } = await staged.json() as { id: string }
    const { GET } = await import("@/app/api/restore/[id]/route")
    const res = await GET(new NextRequest(`http://localhost/api/restore/${id}`), {
      params: Promise.resolve({ id }),
    })
    expect(res.status).toBe(200)
    const plan = await res.json() as {
      id: string
      persons: { bundle_id: number; name: string; date_of_birth: string | null; suggested_action: "new" | "map" | "skip"; target_id: number | null }[]
      medications: { bundle_id: number; name: string; suggested_action: "new" | "map"; target_id: number | null }[]
      differences: { kind: string; medication?: string; field: string; existing: unknown; export: unknown }[]
      accounts: unknown
      favourites: unknown
      settings: unknown
    }
    return { id, plan }
  }

  async function applyZip(bytes: Buffer) {
    const { id, plan } = await stageAndPlan(bytes)
    const { POST } = await import("@/app/api/restore/[id]/apply/route")
    const res = await POST(new NextRequest(`http://localhost/api/restore/${id}/apply`, {
      method: "POST",
      body: JSON.stringify({
        persons: plan.persons.map(person => ({
          bundle_id: person.bundle_id, action: person.suggested_action, target_id: person.target_id,
        })),
        medications: plan.medications.map(medication => ({
          bundle_id: medication.bundle_id, action: medication.suggested_action, target_id: medication.target_id,
        })),
      }),
      headers: { "content-type": "application/json" },
    }), { params: Promise.resolve({ id }) })
    return { res, plan }
  }

  function freshInstance(withSmtp = false) {
    testDb.close()
    testDb = new Database(":memory:")
    applyBaselineSchema(testDb)
    syncTestMetricCatalogue(testDb)
    insertAdmin()
    if (withSmtp) seedSmtpSettings()
  }

  async function applyHousehold(bytes: Buffer, accountChoices?: { bundle_id: number; included: boolean; role?: string }[]) {
    const { id, plan } = await stageAndPlan(bytes)
    const { POST } = await import("@/app/api/restore/[id]/apply/route")
    const res = await POST(new NextRequest(`http://localhost/api/restore/${id}/apply`, {
      method: "POST",
      body: JSON.stringify({
        persons: plan.persons.map(person => ({
          bundle_id: person.bundle_id, action: person.suggested_action, target_id: person.target_id,
        })),
        medications: plan.medications.map(medication => ({
          bundle_id: medication.bundle_id, action: medication.suggested_action, target_id: medication.target_id,
        })),
        accounts: accountChoices,
      }),
      headers: { "content-type": "application/json" },
    }), { params: Promise.resolve({ id }) })
    return { res, plan, id }
  }

  it("restores a household export into an empty instance", async () => {
    const zip = await exportHousehold()
    freshInstance()
    const { id, plan } = await stageAndPlan(zip)
    expect(plan.persons.map(person => person.name).sort()).toEqual(["Alex", "Robin", "Sam"])
    expect(plan.persons.every(person => person.suggested_action === "new")).toBe(true)

    const { POST } = await import("@/app/api/restore/[id]/apply/route")
    const res = await POST(new NextRequest(`http://localhost/api/restore/${id}/apply`, {
      method: "POST",
      body: JSON.stringify({
        persons: plan.persons.map(person => ({
          bundle_id: person.bundle_id, action: person.suggested_action, target_id: person.target_id,
        })),
        medications: plan.medications.map(medication => ({
          bundle_id: medication.bundle_id, action: medication.suggested_action, target_id: medication.target_id,
        })),
      }),
      headers: { "content-type": "application/json" },
    }), { params: Promise.resolve({ id }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.created.persons).toBe(3)

    const { GET: listPeople } = await import("@/app/api/people/route")
    const people = await (await listPeople(new NextRequest("http://localhost/api/people?include_inactive=1"))).json() as { name: string; is_active: number }[]
    expect(people.map(person => person.name).sort()).toEqual(["Alex", "Robin", "Sam"])
    expect(people.find(person => person.name === "Robin")?.is_active).toBe(0)
  })

  it("finishes setup from restored people without creating a separate first person", async () => {
    const zip = await exportPerson(1)
    freshInstance()
    const sessionInfo = {
      authenticated: true,
      isAdmin: true,
      entraSession: false,
      localUserId: 1,
      email: "admin@example.com",
    }
    const before = getSetupWizardContext(testDb, sessionInfo)
    expect(isSetupComplete(testDb)).toBe(false)
    expect(before.steps).toEqual(["person", "timezone", "smtp"])
    expect(before.initialStep).toBe("person")

    const { res } = await applyZip(zip)
    expect(res.status).toBe(200)

    const after = getSetupWizardContext(testDb, sessionInfo)
    expect(after.steps).toEqual(before.steps)
    expect(after.displaySteps).toEqual(before.displaySteps)
    expect(after.initialStep).toBe("timezone")

    const { POST } = await import("@/app/api/setup/complete/route")
    const complete = await POST(new NextRequest("http://localhost/api/setup/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timezone: "Europe/London" }),
    }))
    expect(complete.status).toBe(200)
    expect(isSetupComplete(testDb)).toBe(true)

    const { GET: listPeople } = await import("@/app/api/people/route")
    const people = await (await listPeople(new NextRequest("http://localhost/api/people"))).json() as { name: string; date_of_birth: string }[]
    expect(people).toEqual([expect.objectContaining({ name: "Alex", date_of_birth: "2015-04-02" })])
  })

  it("restores an export into an empty instance, and a second run adds nothing", async () => {
    const zip = await exportPerson(1)
    freshInstance()
    testDb.prepare("UPDATE observation_type_config SET is_active = 0 WHERE observation_type = 'Temperature'").run()

    const { res } = await applyZip(zip)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.created).toMatchObject({
      persons: 1, medications: 2, administrations: 2, observations: 4, test_results: 1,
      test_result_values: 3, symptoms: 1, symptom_dose_links: 1,
    })
    expect(body.skipped_unknown.filter((row: { catalogue: string }) => row.catalogue === "test_metric")).toEqual([])
    expect(body.accounts).toBe("not restored")
    expect(body.favourites).toBe("not restored")
    expect(body.settings).toBe("not restored")

    const { GET: listPeople } = await import("@/app/api/people/route")
    const people = await (await listPeople(new NextRequest("http://localhost/api/people"))).json() as { id: number; name: string; date_of_birth: string }[]
    expect(people.map(person => ({ name: person.name, date_of_birth: person.date_of_birth }))).toEqual([
      { name: "Alex", date_of_birth: "2015-04-02" },
    ])

    const restored = await exportPerson(people[0].id)
    const dir = mkdtempSync(join(tmpdir(), "fc-restored-"))
    const zipPath = join(dir, "export.zip")
    const { writeFileSync } = await import("fs")
    const { execFileSync } = await import("child_process")
    writeFileSync(zipPath, restored)
    const payload = JSON.parse(execFileSync("unzip", ["-p", zipPath, "person.json"], { encoding: "utf8" }))
    const medicationName = (id: number) => payload.medications.find((med: { id: number; name: string }) => med.id === id).name
    expect(payload.administrations.map((row: { medication_id: number; recorded_at: string; dosage: number; dosage_unit: string }) => ({
      medication: medicationName(row.medication_id), recorded_at: row.recorded_at, dosage: row.dosage, dosage_unit: row.dosage_unit,
    }))).toEqual([
      { medication: "Paracetamol", recorded_at: "2026-02-01T08:00:00.000Z", dosage: 250, dosage_unit: "mg" },
      { medication: "Ibuprofen", recorded_at: "2026-02-01T14:00:00.000Z", dosage: 200, dosage_unit: "mg" },
    ])
    expect(payload.observations.map((row: { observation_type: string; value: number }) => [row.observation_type, row.value])).toEqual([
      ["Head Circumference", 52],
      ["Weight", 21.5],
      ["Blood Pressure", 105],
      ["Blood Pressure", 68],
    ])
    expect(payload.test_results[0].values.map((row: { metric_name: string }) => row.metric_name)).toEqual(["Ferritin", "Iron", "Coeliac screen"])
    expect(payload.symptoms[0].label).toBe("Headache")
    expect(payload.symptom_dose_links).toHaveLength(1)
    expect(payload.assignments.find((row: { schedule_times: string }) => row.schedule_times === '["08:00"]').schedule_created_at_ms).toBe(1767268800000)
    expect(payload.catalogues.observation_types).toContainEqual({ name: "Head Circumference", is_active: 0 })
    expect(payload.catalogues.observation_types).toContainEqual({ name: "Temperature", is_active: 0 })
    expect(payload.catalogues.test_metrics).toContainEqual({ name: "Iron", is_active: 0 })
    expect(payload.catalogues.test_metrics).toContainEqual({ name: "Ferritin", is_active: 1 })

    const photoName = payload.person.photo.original_name as string
    expect(await readUpload("people", photoName)).toEqual(Buffer.from("alex-jpeg-bytes"))
    const reportName = payload.test_results[0].report.original_name as string
    expect(await readUpload("test-results", reportName)).toEqual(Buffer.from("iron-pdf-bytes"))

    const appVersion = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).version as string
    const { GET: audit } = await import("@/app/api/admin/audit-log/route")
    const log = await (await audit(new NextRequest("http://localhost/api/admin/audit-log?action=RESTORE&limit=10"))).json() as {
      rows: { action: string; details: string }[]
    }
    expect(JSON.parse(log.rows[0].details)).toMatchObject({
      scope: "person", format_version: 2, app_version: appVersion,
    })
    const all = await (await audit(new NextRequest("http://localhost/api/admin/audit-log?limit=100"))).json() as {
      rows: { action: string; entity_type: string; details: string | null }[]
    }
    const weight = all.rows.find(row => row.action === "CREATE" && row.entity_type === "observations" && row.details?.includes("Weight"))
    expect(JSON.parse(weight!.details!)).toEqual({ person_id: people[0].id, observation_type: "Weight" })

    const { plan: again } = await stageAndPlan(zip)
    expect(again.persons).toEqual([
      { bundle_id: 1, name: "Alex", date_of_birth: "2015-04-02", suggested_action: "map", target_id: people[0].id },
    ])
    const second = await applyZip(zip)
    expect(second.res.status).toBe(200)
    expect((await second.res.json()).counts.new).toBe(0)
    const exportedAgain = await exportPerson(people[0].id)
    writeFileSync(zipPath, exportedAgain)
    const secondPayload = JSON.parse(execFileSync("unzip", ["-p", zipPath, "person.json"], { encoding: "utf8" }))
    expect(secondPayload.administrations).toHaveLength(2)
    expect(secondPayload.observations).toHaveLength(4)
  })

  describe("slot outcomes", () => {
    const outcomeRows = () => testDb.prepare(
      `SELECT m.name AS medication, so.local_ymd, so.slot_hhmm, so.result, so.offset_minutes, so.missed_cause,
              mr.recorded_at, mr.person_id = pm.person_id AS dose_is_same_person
       FROM slot_outcomes so
       JOIN person_medications pm ON pm.id = so.person_medication_id
       JOIN medications m ON m.id = pm.medication_id
       LEFT JOIN medication_records mr ON mr.id = so.medication_record_id
       ORDER BY pm.person_id, so.local_ymd, so.slot_hhmm`,
    ).all()

    it("keeps the original settle time, so an old Missed slot is not read as one that became Missed today", async () => {
      testDb.prepare("UPDATE slot_outcomes SET created_at = '2026-02-03 09:00:00' WHERE result = 'missed'").run()
      const zip = await exportPerson(1)
      freshInstance()
      expect((await applyZip(zip)).res.status).toBe(200)
      const settled = testDb.prepare("SELECT created_at FROM slot_outcomes WHERE result = 'missed'").get() as { created_at: string }
      expect(settled.created_at).toBe("2026-02-03 09:00:00")
    })

    it("restores them onto the restored assignments and doses, counts them, and adds nothing on a second apply", async () => {
      const zip = await exportPerson(1)
      freshInstance()
      const first = await applyZip(zip)
      expect(first.res.status).toBe(200)
      const body = await first.res.json()
      expect(body.created.slot_outcomes).toBe(2)
      expect(body.duplicates.slot_outcomes).toBe(0)
      expect(outcomeRows()).toEqual([
        {
          medication: "Paracetamol", local_ymd: "2026-02-01", slot_hhmm: "08:00", result: "on_time", offset_minutes: 0,
          missed_cause: null, recorded_at: "2026-02-01T08:00:00.000Z", dose_is_same_person: 1,
        },
        {
          medication: "Paracetamol", local_ymd: "2026-02-03", slot_hhmm: "08:00", result: "missed", offset_minutes: null,
          missed_cause: "timed_out", recorded_at: null, dose_is_same_person: null,
        },
      ])

      const second = await applyZip(zip)
      expect(second.res.status).toBe(200)
      const again = await second.res.json()
      expect(again.counts.new).toBe(0)
      expect(again.duplicates.slot_outcomes).toBe(2)
      expect(outcomeRows()).toHaveLength(2)
    })

    it("previews the same counts that apply then adds", async () => {
      const zip = await exportHousehold()
      freshInstance()
      const staged = await stage(zip)
      const { id } = await staged.json() as { id: string }
      const { GET } = await import("@/app/api/restore/[id]/route")
      const planned = await (await GET(new NextRequest(`http://localhost/api/restore/${id}`), { params: Promise.resolve({ id }) })).json()
      expect(planned.created.slot_outcomes).toBe(3)
      const applied = await applyHousehold(zip)
      expect(applied.res.status).toBe(200)
      expect((await applied.res.json()).created.slot_outcomes).toBe(3)
      expect(outcomeRows()).toHaveLength(3)
    })

    it("counts an outcome already on the instance as a duplicate and keeps it", async () => {
      const zip = await exportPerson(1)
      const res = await applyZip(zip)
      expect(res.res.status).toBe(200)
      const body = await res.res.json()
      expect(body.created.slot_outcomes).toBe(0)
      expect(body.duplicates.slot_outcomes).toBe(2)
      expect(outcomeRows()).toHaveLength(3)
    })

    it("keeps the outcome an existing duplicate dose already holds instead of attaching a second one", async () => {
      const zip = await exportPerson(1)
      testDb.prepare("DELETE FROM slot_outcomes WHERE person_medication_id = 20 AND local_ymd = '2026-02-01'").run()
      const doseId = (testDb.prepare("SELECT id FROM medication_records WHERE id = 30").get() as { id: number }).id
      testDb.prepare(
        `INSERT INTO slot_outcomes (person_medication_id, local_ymd, slot_hhmm, result, offset_minutes, medication_record_id)
         VALUES (20, '2026-02-01', '12:00', 'late', 15, ?)`,
      ).run(doseId)
      const res = await applyZip(zip)
      expect(res.res.status).toBe(200)
      const body = await res.res.json()
      expect(body.created.slot_outcomes).toBe(0)
      expect(body.duplicates.slot_outcomes).toBe(2)
      expect(
        testDb.prepare("SELECT slot_hhmm, result FROM slot_outcomes WHERE medication_record_id = ?").all(doseId),
      ).toEqual([{ slot_hhmm: "12:00", result: "late" }])
    })

    it("restores an export that has no slot outcomes section", async () => {
      freshInstance(true)
      const bytes = await zipEntries([{
        name: "manifest.json",
        content: JSON.stringify({
          format_version: 2, scope: "person", app_version: "1.1.0", exported_at: "2026-01-01T00:00:00.000Z",
          sections: ["person"], counts: { person: 1 }, skipped_files: [],
        }),
      }, {
        name: "person.json",
        content: JSON.stringify({
          person: { id: 1, db_id: 1, name: "Pat", full_name: null, date_of_birth: null, color: "#256AA5", is_active: 1, photo: null },
          medications: [], assignments: [], administrations: [], observations: [], test_results: [], symptoms: [],
          symptom_dose_links: [], observation_goals: [], observation_expectations: [],
          catalogues: { observation_types: [], test_metrics: [] },
        }),
      }])
      const res = await applyZip(bytes)
      expect(res.res.status).toBe(200)
      expect((await res.res.json()).created.slot_outcomes).toBe(0)
    })

    it("refuses an outcome with an unknown result and writes nothing", async () => {
      const zip = await exportPerson(1)
      freshInstance()
      const tampered = await tamperPersonJson(zip, payload => {
        ;(payload.slot_outcomes as { result: string }[])[0].result = "perfect"
      })
      const staged = await stage(tampered)
      const { id } = await staged.json() as { id: string }
      const { GET } = await import("@/app/api/restore/[id]/route")
      const planned = await GET(new NextRequest(`http://localhost/api/restore/${id}`), { params: Promise.resolve({ id }) })
      expect(planned.status).toBe(400)
      expect((await planned.json()).error).toContain("slot outcome")
      expect(testDb.prepare("SELECT COUNT(*) AS n FROM people").get()).toEqual({ n: 0 })
    })
  })

  it("matches a test result to the event that shares its values when an empty event has the same name and date", async () => {
    const zip = await exportPerson(1)
    freshInstance()
    expect((await applyZip(zip)).res.status).toBe(200)
    const event = testDb.prepare("SELECT * FROM test_events ORDER BY id LIMIT 1").get() as Record<string, unknown>
    testDb.prepare(
      "INSERT INTO test_events (person_id, test_type, name, date, ordered_by, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(event.person_id, event.test_type, event.name, event.date, event.ordered_by, event.notes, event.created_by, event.created_at)
    // Move the values to the newer event so the older one is the empty duplicate a plain lookup would hit first.
    const newest = testDb.prepare("SELECT MAX(id) AS id FROM test_events").get() as { id: number }
    testDb.prepare("UPDATE test_result_values SET test_event_id = ?").run(newest.id)
    const second = await applyZip(zip)
    expect(second.res.status).toBe(200)
    const body = await second.res.json()
    expect(body.counts).toMatchObject({ new: 0, differing: 0 })
    expect(testDb.prepare("SELECT COUNT(*) AS n FROM test_events").get()).toEqual({ n: 2 })
  })

  it("skips duplicates in a household that already has some of the export and keeps its configuration", async () => {
    const zip = await exportPerson(1)
    freshInstance()
    testDb.exec(`
      INSERT INTO people (id, name, full_name, date_of_birth, color) VALUES (7, 'Alex', 'Alex Example', '2015-04-02', '#256AA5');
      INSERT INTO medications (id, name, dosage_unit, default_dosage) VALUES (4, 'paracetamol', 'mg', 250);
      INSERT INTO medication_frequency_rules (medication_id, min_hours_between, max_per_24h_count_doses) VALUES (4, 8, 0);
      INSERT INTO person_medications (person_id, medication_id, is_active, schedule_times) VALUES (7, 4, 1, '["09:00"]');
      INSERT INTO medication_records (person_id, medication_id, recorded_at, dosage, dosage_unit) VALUES
        (7, 4, '2026-02-01T08:00:00.000Z', 250, 'mg');
    `)
    const { res, plan } = await applyZip(zip)
    expect(res.status).toBe(200)
    expect(plan.persons[0]).toMatchObject({ suggested_action: "map", target_id: 7 })
    expect(plan.medications).toContainEqual(expect.objectContaining({ name: "Paracetamol", suggested_action: "map", target_id: 4 }))
    expect(plan.differences).toContainEqual({
      kind: "frequency_rule", medication: "Paracetamol", field: "min_hours_between", existing: 8, export: 4,
    })
    expect(plan.differences).toContainEqual(expect.objectContaining({
      kind: "schedule", medication: "Paracetamol", field: "schedule_times", existing: '["09:00"]', export: '["08:00"]',
    }))
    const body = await res.json()
    expect(body.created.persons).toBe(0)
    expect(body.created.administrations).toBe(1)
    expect(body.duplicates.administrations).toBe(1)

    const { GET: listPeople } = await import("@/app/api/people/route")
    const people = await (await listPeople(new NextRequest("http://localhost/api/people"))).json() as { id: number }[]
    const exported = await exportPerson(people[0].id)
    const { writeFileSync } = await import("fs")
    const { execFileSync } = await import("child_process")
    const zipPath = join(stageDir, "merged.zip")
    writeFileSync(zipPath, exported)
    const payload = JSON.parse(execFileSync("unzip", ["-p", zipPath, "person.json"], { encoding: "utf8" }))
    const paracetamol = payload.medications.find((med: { name: string }) => med.name.toLowerCase() === "paracetamol")
    expect(paracetamol.frequency_rules[0].min_hours_between).toBe(8)
    const assignment = payload.assignments.find((row: { medication_id: number }) => row.medication_id === paracetamol.id)
    expect(assignment.schedule_times).toBe('["09:00"]')
    expect(payload.administrations).toHaveLength(2)
  })

  it("restores history for a switched-off type and lists a type the instance does not have", async () => {
    const zip = await exportPerson(1)
    freshInstance()
    testDb.prepare("UPDATE observation_type_config SET is_active = 0 WHERE observation_type = 'Head Circumference'").run()
    testDb.prepare("UPDATE test_metric_config SET is_active = 0 WHERE metric_name = 'Iron'").run()
    testDb.prepare("DELETE FROM observation_type_config WHERE observation_type = 'Blood Pressure'").run()
    const { res } = await applyZip(zip)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.skipped_unknown).toContainEqual({ catalogue: "observation_type", name: "Blood Pressure", count: 2 })
    expect(body.created.observations).toBe(2)

    const { GET: listPeople } = await import("@/app/api/people/route")
    const people = await (await listPeople(new NextRequest("http://localhost/api/people"))).json() as { id: number }[]
    const exported = await exportPerson(people[0].id)
    const { writeFileSync } = await import("fs")
    const { execFileSync } = await import("child_process")
    const zipPath = join(stageDir, "switched.zip")
    writeFileSync(zipPath, exported)
    const payload = JSON.parse(execFileSync("unzip", ["-p", zipPath, "person.json"], { encoding: "utf8" }))
    expect(payload.observations.map((row: { observation_type: string; value: number }) => [row.observation_type, row.value])).toEqual([
      ["Head Circumference", 52],
      ["Weight", 21.5],
    ])
    expect(payload.catalogues.observation_types).toContainEqual({ name: "Head Circumference", is_active: 0 })
    expect(payload.catalogues.observation_types.find((row: { name: string }) => row.name === "Blood Pressure")).toBeUndefined()
    const iron = payload.test_results[0].values.find((row: { metric_name: string }) => row.metric_name === "Iron")
    expect(iron.numeric_value).toBe(5)
    expect(payload.catalogues.test_metrics).toContainEqual({ name: "Iron", is_active: 0 })
  })

  it("rolls every row back when the database fails during apply", async () => {
    const zip = await exportPerson(1)
    freshInstance()
    const real = testDb
    testDb = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === "transaction") {
          return (fn: () => void) => target.transaction(() => {
            fn()
            throw new Error("injected")
          })
        }
        const value = Reflect.get(target, prop, receiver)
        return typeof value === "function" ? value.bind(target) : value
      },
    }) as Database.Database
    const { res } = await applyZip(zip)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "Restore failed — all changes rolled back" })
    testDb = real
    const { GET: listPeople } = await import("@/app/api/people/route")
    expect(await (await listPeople(new NextRequest("http://localhost/api/people"))).json()).toEqual([])
  })

  it("removes this restore's files when a write fails and reports which one", async () => {
    const zip = await exportPerson(1)
    freshInstance()
    const memory = createMemoryUploadBlobAdapter()
    __setUploadBlobAdapterForTests({
      ...memory,
      put: async (bucket, filename, data) => {
        if (bucket === "test-results") throw new Error("disk full")
        await memory.put(bucket, filename, data)
      },
    })
    const { res } = await applyZip(zip)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      error: "Restore failed while writing files",
      files_failed: ["attachments/report-1.pdf"],
    })
    const { listUploadMeta } = await import("@/lib/uploads/store")
    expect(await listUploadMeta("people")).toEqual([])
    expect(await listUploadMeta("test-results")).toEqual([])
    const { GET: listPeople } = await import("@/app/api/people/route")
    const people = await (await listPeople(new NextRequest("http://localhost/api/people"))).json() as { id: number; photo_url: string | null }[]
    expect(people).toHaveLength(1)
    expect(people[0].photo_url).toBeNull()
  })

  it("applies a 100 MB export synchronously", async () => {
    const { closeSync, createReadStream, fstatSync, openSync, writeSync } = await import("fs")
    const { Readable } = await import("stream")
    const zipPath = join(stageDir, "large.zip")
    const manifest = Buffer.from(JSON.stringify({
      format_version: 1, scope: "person", app_version: "1.1.0", exported_at: "2026-01-01T00:00:00.000Z",
      sections: ["person"], counts: { person: 1 }, skipped_files: [],
    }))
    const person = Buffer.from(JSON.stringify({
      person: { id: 1, db_id: 1, name: "Pad", full_name: null, date_of_birth: null, color: "#256AA5", is_active: 1, photo: null },
      medications: [], assignments: [], administrations: [], observations: [], test_results: [], symptoms: [],
      symptom_dose_links: [], observation_goals: [], observation_expectations: [],
      catalogues: { observation_types: [], test_metrics: [] },
    }))
    writeStoredZip(zipPath, [
      { name: "manifest.json", data: manifest },
      { name: "person.json", data: person },
    ], "attachments/pad.bin", 100 * 1024 * 1024)

    freshInstance()
    const { POST } = await import("@/app/api/restore/upload/route")
    const started = Date.now()
    const staged = await POST(new NextRequest("http://localhost/api/restore/upload", {
      method: "POST",
      body: Readable.toWeb(createReadStream(zipPath)) as ReadableStream<Uint8Array>,
      duplex: "half",
      headers: { "content-type": "application/zip" },
    }))
    expect(staged.status).toBe(200)
    const { id } = await staged.json() as { id: string }
    const { GET } = await import("@/app/api/restore/[id]/route")
    const planRes = await GET(new NextRequest(`http://localhost/api/restore/${id}`), { params: Promise.resolve({ id }) })
    const plan = await planRes.json()
    const { POST: apply } = await import("@/app/api/restore/[id]/apply/route")
    const applied = await apply(new NextRequest(`http://localhost/api/restore/${id}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        persons: plan.persons.map((row: { bundle_id: number; suggested_action: string; target_id: number | null }) => ({
          bundle_id: row.bundle_id, action: row.suggested_action, target_id: row.target_id,
        })),
        medications: [],
      }),
    }), { params: Promise.resolve({ id }) })
    expect(applied.status).toBe(200)
    expect(Date.now() - started).toBeLessThan(30_000)
    const { GET: listPeople } = await import("@/app/api/people/route")
    const people = await (await listPeople(new NextRequest("http://localhost/api/people"))).json() as { name: string }[]
    expect(people.map(row => row.name)).toEqual(["Pad"])

    function writeStoredZip(
      path: string,
      files: { name: string; data: Buffer }[],
      padName: string,
      padBytes: number,
    ) {
      const fd = openSync(path, "w")
      const entries: { name: string; size: number; offset: number }[] = []
      const writeLocal = (name: string, size: number, data: Buffer | null) => {
        const offset = fstatSync(fd).size
        const nameBuf = Buffer.from(name)
        const header = Buffer.alloc(30)
        header.writeUInt32LE(0x04034b50, 0)
        header.writeUInt16LE(20, 4)
        header.writeUInt32LE(size, 18)
        header.writeUInt32LE(size, 22)
        header.writeUInt16LE(nameBuf.length, 26)
        writeSync(fd, header)
        writeSync(fd, nameBuf)
        if (data) writeSync(fd, data)
        else {
          const chunk = Buffer.alloc(1024 * 1024)
          let left = size
          while (left > 0) {
            const n = Math.min(chunk.length, left)
            writeSync(fd, chunk, 0, n)
            left -= n
          }
        }
        entries.push({ name, size, offset })
      }
      for (const file of files) writeLocal(file.name, file.data.length, file.data)
      writeLocal(padName, padBytes, null)
      const cdOffset = fstatSync(fd).size
      for (const entry of entries) {
        const nameBuf = Buffer.from(entry.name)
        const header = Buffer.alloc(46)
        header.writeUInt32LE(0x02014b50, 0)
        header.writeUInt16LE(20, 4)
        header.writeUInt16LE(20, 6)
        header.writeUInt32LE(entry.size, 20)
        header.writeUInt32LE(entry.size, 24)
        header.writeUInt16LE(nameBuf.length, 28)
        header.writeUInt32LE(entry.offset, 42)
        writeSync(fd, header)
        writeSync(fd, nameBuf)
      }
      const cdSize = fstatSync(fd).size - cdOffset
      const eocd = Buffer.alloc(22)
      eocd.writeUInt32LE(0x06054b50, 0)
      eocd.writeUInt16LE(entries.length, 8)
      eocd.writeUInt16LE(entries.length, 10)
      eocd.writeUInt32LE(cdSize, 12)
      eocd.writeUInt32LE(cdOffset, 16)
      writeSync(fd, eocd)
      closeSync(fd)
    }
  }, 60_000)

  describe("Accounts as pending Invites", () => {
    it("creates Invites with roles and Personal-links, skips existing emails, and sends mail after commit", async () => {
      const zip = await exportHousehold()
      freshInstance(true)
      testDb.prepare("INSERT INTO accounts (id, email, role) VALUES (9, 'manager@example.com', 'manage')").run()
      const { res, plan } = await applyHousehold(zip)
      expect(res.status).toBe(200)
      expect(plan.accounts).toMatchObject({ status: "ready" })
      const body = await res.json()
      expect(body.accounts_result).toMatchObject({
        status: "applied",
        invites_created: 2,
        invites_skipped: 3,
        emails_sent: 2,
        emails_failed: 0,
      })

      const sam = testDb.prepare(
        "SELECT id, role, status, invite_token_hash FROM accounts WHERE email = 'sam@example.com'",
      ).get() as { id: number; role: string; status: string; invite_token_hash: string | null }
      expect(sam.status).toBe("invited")
      expect(sam.role).toBe("none")
      expect(sam.invite_token_hash).toBeTruthy()
      const samPerson = testDb.prepare("SELECT account_uid FROM people WHERE name = 'Sam'").get() as { account_uid: string }
      expect(samPerson.account_uid).toBe(`local:${sam.id}`)

      const manager = testDb.prepare("SELECT id, status FROM accounts WHERE email = 'manager@example.com'").get() as {
        id: number
        status: string
      }
      expect(manager.id).toBe(9)
      expect(manager.status).not.toBe("invited")

      expect(sendOutboundEmailCalls).toBe(2)
    })

    it("skips the Accounts step without email configured, then adds them on a second run", async () => {
      emailConfigured = false
      const zip = await exportHousehold()
      freshInstance(false)
      const { res: first } = await applyHousehold(zip)
      expect(first.status).toBe(200)
      const firstBody = await first.json()
      expect(firstBody.created.persons).toBe(3)
      expect(firstBody.accounts_result).toMatchObject({
        status: "skipped_preflight",
        message: ACCOUNTS_SKIPPED_NO_EMAIL,
        invites_created: 0,
      })
      expect(testDb.prepare("SELECT id FROM accounts WHERE email = 'sam@example.com'").get()).toBeUndefined()
      expect(sendOutboundEmailCalls).toBe(0)

      emailConfigured = true
      seedSmtpSettings()
      sendOutboundEmailCalls = 0
      const { res: second } = await applyHousehold(zip)
      expect(second.status).toBe(200)
      const secondBody = await second.json()
      expect(secondBody.accounts_result?.invites_created).toBe(3)
      expect(testDb.prepare("SELECT status FROM accounts WHERE email = 'sam@example.com'").get()).toMatchObject({
        status: "invited",
      })
      expect(sendOutboundEmailCalls).toBe(3)
    })

    async function tamperAccounts(
      zip: Buffer,
      mutate: (accounts: Record<string, unknown>[]) => Record<string, unknown>[],
    ): Promise<Buffer> {
      const dir = mkdtempSync(join(tmpdir(), "fc-tamper-"))
      const path = join(dir, "in.zip")
      writeFileSync(path, zip)
      const reader = ZipFile.open(path)
      const entries: { name: string; content: Buffer }[] = []
      try {
        for (const entry of reader.entries) entries.push({ name: entry.name, content: reader.read(entry.name)! })
      } finally {
        reader.close()
      }
      const out = entries.map(entry => {
        if (entry.name !== "household.json") return { name: entry.name, content: entry.content.toString("latin1") }
        const payload = JSON.parse(entry.content.toString("utf8")) as { accounts: Record<string, unknown>[] }
        payload.accounts = mutate(payload.accounts)
        return { name: entry.name, content: JSON.stringify(payload) }
      })
      return zipEntries(out)
    }

    it("skips Accounts with an invalid role, can_report or an unlinked None role, with a visible reason", async () => {
      const zip = await tamperAccounts(await exportHousehold(), accounts => [
        ...accounts.filter(row => row.email === "sam@example.com"),
        { ...accounts.find(row => row.email === "writer@example.com"), id: 90, email: "bogus@example.com", role: "superuser", can_report: 1 },
        { ...accounts.find(row => row.email === "writer@example.com"), id: 91, email: "report@example.com", role: "write", can_report: 7 },
        { ...accounts.find(row => row.email === "writer@example.com"), id: 92, email: "nolink@example.com", role: "none", can_report: 0, person_id: null },
        { ...accounts.find(row => row.email === "writer@example.com"), id: 93, email: "ok@example.com", role: "read", can_report: 1 },
      ])
      freshInstance(true)
      const { res, plan } = await applyHousehold(zip)
      expect(res.status).toBe(200)
      const items = (plan.accounts as { items: { email: string; skip_reason: string | null; note: string | null; included: boolean }[] }).items
      for (const email of ["bogus@example.com", "report@example.com", "nolink@example.com"]) {
        const item = items.find(row => row.email === email)!
        expect(item).toMatchObject({ skip_reason: "invalid", included: false })
        expect(item.note).toBeTruthy()
      }
      expect(items.find(row => row.email === "ok@example.com")).toMatchObject({ skip_reason: null, included: true })
      const body = await res.json()
      expect(body.accounts_result).toMatchObject({ invites_created: 2, invites_skipped: 3 })
      const emails = (testDb.prepare("SELECT email FROM accounts WHERE email != 'admin@example.com' ORDER BY email").all() as { email: string }[]).map(r => r.email)
      expect(emails).toEqual(["ok@example.com", "sam@example.com"])
      expect(testDb.prepare("SELECT can_report FROM accounts WHERE email = 'ok@example.com'").get()).toEqual({ can_report: 1 })
    })

    it("never reads credentials from the export and never changes an existing Account", async () => {
      const zip = await exportHousehold()
      freshInstance(true)
      testDb.prepare(
        "INSERT INTO accounts (id, email, role, password_hash, totp_secret, session_version) VALUES (9, 'manager@example.com', 'write', 'hash', 'secret', 2)",
      ).run()
      await applyHousehold(zip)
      const row = testDb.prepare(
        "SELECT role, password_hash, totp_secret, session_version FROM accounts WHERE id = 9",
      ).get() as { role: string; password_hash: string; totp_secret: string; session_version: number }
      expect(row).toEqual({ role: "write", password_hash: "hash", totp_secret: "secret", session_version: 2 })
    })

    it("notes when sign-in method changes between export and target", async () => {
      testDb.prepare("UPDATE accounts SET auth_method = 'entra', external_id = 'oid-entra' WHERE id = 3").run()
      const zip = await exportHousehold()
      freshInstance(true)
      await stageAndPlan(zip)
      testDb.close()
      testDb = new Database(":memory:")
      applyBaselineSchema(testDb)
      insertAdmin()
      seedSmtpSettings()
      const staged = await stage(zip)
      const { id } = await staged.json() as { id: string }
      const { GET } = await import("@/app/api/restore/[id]/route")
      const planRes = await GET(new NextRequest(`http://localhost/api/restore/${id}`), { params: Promise.resolve({ id }) })
      const localPlan = await planRes.json()
      const entraItem = localPlan.accounts.items.find((row: { email: string }) => row.email === "manager@example.com")
      expect(entraItem.method_change_note).toMatch(/local email invites/)

      testDb.prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ('auth.entra.enabled', 'true', ?),
         ('auth.entra.client_id', 'cid', ?), ('auth.entra.tenant_id', 'tid', ?), ('auth.entra.client_secret', 'sec', ?)`,
      ).run(Date.now(), Date.now(), Date.now(), Date.now())
      const planEntraRes = await GET(new NextRequest(`http://localhost/api/restore/${id}`), { params: Promise.resolve({ id }) })
      const entraPlan = await planEntraRes.json()
      const localItem = entraPlan.accounts.items.find((row: { email: string }) => row.email === "sam@example.com")
      expect(localItem.method_change_note).toMatch(/Entra sign-in/)
      expect(entraPlan.accounts.status).toBe("ready")
    })

    it("lets the Admin choose the role of an Entra Account restored to a local-invite instance", async () => {
      testDb.prepare("UPDATE accounts SET auth_method = 'entra', external_id = 'oid-entra' WHERE id = 3").run()
      const zip = await exportHousehold()
      freshInstance(true)
      const { plan } = await stageAndPlan(zip)
      const entra = (plan as { accounts: { items: { email: string; bundle_id: number; role_needs_choice: boolean }[] } }).accounts.items.find((row: { email: string }) => row.email === "manager@example.com")
      expect(entra!.role_needs_choice).toBe(true)
      const local = (plan as { accounts: { items: { email: string; bundle_id: number; role_needs_choice: boolean }[] } }).accounts.items.find((row: { email: string }) => row.email === "sam@example.com")
      expect(local!.role_needs_choice).toBe(false)

      // A role override on a local Account is ignored; on the Entra Account it is applied.
      const { res } = await applyHousehold(zip, [
        { bundle_id: entra!.bundle_id, included: true, role: "manage" },
        { bundle_id: local!.bundle_id, included: true, role: "admin" },
      ])
      expect(res.status).toBe(200)
      expect(testDb.prepare("SELECT role FROM accounts WHERE email = 'manager@example.com'").get()).toEqual({ role: "manage" })
      expect(testDb.prepare("SELECT role FROM accounts WHERE email = 'sam@example.com'").get()).toEqual({ role: "none" })
    })
  })

  describe("Favourites and instance settings", () => {
    it("restores Favourites onto new Accounts so they reference the mapped Person and medication after the Invite is accepted", async () => {
      testDb.prepare(
        `INSERT INTO favourites (user_uid, person_id, action_kind, medication_id, observation_type, default_value, label, sort_order)
         VALUES ('local:2', 1, 'medication', 10, NULL, '250', 'Morning dose', 0),
                ('local:2', 1, 'observation', NULL, 'Hydration', '250', 'Water', 1),
                ('local:3', 1, 'medication', 10, NULL, '1', 'Manager dose', 0)`,
      ).run()
      testDb.prepare(
        "INSERT INTO user_settings (user_uid, key, value, updated_at) VALUES ('local:2', 'locale.timezone', 'Australia/Sydney', ?)",
      ).run(Date.now())
      const zip = await exportHousehold()
      freshInstance(true)
      testDb.exec(`
        INSERT INTO people (id, name, date_of_birth, color) VALUES (7, 'Alex', '2015-04-02', '#256AA5');
        INSERT INTO medications (id, name, dosage_unit) VALUES (4, 'paracetamol', 'mg');
        INSERT INTO accounts (id, email, role) VALUES (9, 'manager@example.com', 'manage');
      `)
      const { res } = await applyHousehold(zip)
      expect(res.status).toBe(200)

      const samMail = sentMails.find(mail => mail.to === "sam@example.com")
      expect(samMail?.text).toMatch(/accept-invite#token=/)
      const token = samMail!.text.match(/accept-invite#token=(\S+)/)![1]
      const { POST: accept } = await import("@/app/api/accounts/invites/accept/route")
      const accepted = await accept(new NextRequest("http://localhost/api/accounts/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password: "long-password", confirmPassword: "long-password" }),
      }))
      expect(accepted.status).toBe(200)

      const { GET: listPeople } = await import("@/app/api/people/route")
      const people = await (await listPeople(new NextRequest("http://localhost/api/people?include_inactive=1"))).json() as {
        id: number
        name: string
        account_uid: string | null
      }[]
      const alex = people.find(person => person.name === "Alex")
      const sam = people.find(person => person.name === "Sam")
      expect(alex?.id).toBe(7)
      expect(sam?.account_uid).toMatch(/^local:/)

      session = { user: { id: sam!.account_uid!, email: "sam@example.com" }, sessionVersion: 0 }
      const { GET: listFavourites } = await import("@/app/api/favourites/route")
      const favourites = await (await listFavourites()).json() as {
        person_id: number
        person_name: string
        medication_id: number | null
        medication_name: string | null
        action_kind: string
        observation_type: string | null
        label: string | null
        resolved: boolean
      }[]
      expect(favourites).toEqual([
        expect.objectContaining({
          person_id: 7,
          person_name: "Alex",
          medication_id: 4,
          medication_name: "paracetamol",
          action_kind: "medication",
          label: "Morning dose",
          resolved: true,
        }),
        expect.objectContaining({
          person_id: 7,
          person_name: "Alex",
          medication_id: null,
          observation_type: "Hydration",
          label: "Water",
          action_kind: "observation",
          resolved: true,
        }),
      ])

      session = { user: { id: "local:9", email: "manager@example.com" }, sessionVersion: 0 }
      const managerFavourites = await (await listFavourites()).json() as { label: string }[]
      expect(managerFavourites.map(row => row.label)).toEqual(["Manager dose"])
    })

    describe("an existing Account matched by email", () => {
      async function exportWithManagerSettings(): Promise<Buffer> {
        testDb.prepare(
          `INSERT INTO favourites (user_uid, person_id, action_kind, medication_id, observation_type, default_value, label, sort_order)
           VALUES ('local:3', 1, 'medication', 10, NULL, '1', 'Manager dose', 0),
                  ('local:3', 1, 'observation', NULL, 'Hydration', '250', 'Water', 1)`,
        ).run()
        testDb.prepare(
          "INSERT INTO user_settings (user_uid, key, value, updated_at) VALUES ('local:3', 'locale.timezone', 'Australia/Sydney', ?)",
        ).run(Date.now())
        return exportHousehold()
      }

      function targetWithManager(timezone: string | null) {
        freshInstance(true)
        testDb.exec(`
          INSERT INTO people (id, name, date_of_birth, color) VALUES (7, 'Alex', '2015-04-02', '#256AA5');
          INSERT INTO medications (id, name, dosage_unit) VALUES (4, 'paracetamol', 'mg');
          INSERT INTO accounts (id, email, role) VALUES (9, 'manager@example.com', 'manage');
        `)
        if (timezone) {
          testDb.prepare(
            "INSERT INTO user_settings (user_uid, key, value, updated_at) VALUES ('local:9', 'locale.timezone', ?, ?)",
          ).run(timezone, Date.now())
        }
      }

      it("adds missing Favourites and unset per-user settings, keeps what exists, and a second apply adds nothing", async () => {
        const zip = await exportWithManagerSettings()
        targetWithManager(null)
        testDb.prepare(
          `INSERT INTO favourites (user_uid, person_id, action_kind, medication_id, observation_type, default_value, label, sort_order)
           VALUES ('local:9', 7, 'observation', NULL, 'Hydration', '500', 'My water', 3)`,
        ).run()

        const { plan } = await stageAndPlan(zip)
        const previewFavs = plan.favourites as { created: number; duplicates: number; not_restored: { reason: string }[]; added_to_existing: { email: string; count: number }[] }
        expect(previewFavs.not_restored.map(row => row.reason)).not.toContain("account not restored")
        expect(previewFavs.created).toBe(1)
        expect(previewFavs.duplicates).toBe(1)
        expect(previewFavs.added_to_existing).toEqual([{ email: "manager@example.com", count: 1 }])

        const first = await applyHousehold(zip)
        expect(first.res.status).toBe(200)
        const rows = () => testDb.prepare(
          "SELECT label, default_value FROM favourites WHERE user_uid = 'local:9' ORDER BY sort_order",
        ).all()
        expect(rows()).toEqual([
          { label: "Manager dose", default_value: "1" },
          { label: "My water", default_value: "500" },
        ])
        expect(testDb.prepare("SELECT value FROM user_settings WHERE user_uid = 'local:9' AND key = 'locale.timezone'").get())
          .toEqual({ value: "Australia/Sydney" })
        expect(testDb.prepare("SELECT role, status FROM accounts WHERE id = 9").get()).toEqual({ role: "manage", status: "active" })

        const second = await applyHousehold(zip)
        const body = await second.res.json() as { favourites: { created: number; duplicates: number } }
        expect(body.favourites).toMatchObject({ created: 0, duplicates: 2 })
        expect(rows()).toHaveLength(2)
      })

      it("keeps a per-user setting the Account already has", async () => {
        const zip = await exportWithManagerSettings()
        targetWithManager("Europe/Paris")
        const { res } = await applyHousehold(zip)
        expect(res.status).toBe(200)
        expect(testDb.prepare("SELECT value FROM user_settings WHERE user_uid = 'local:9' AND key = 'locale.timezone'").get())
          .toEqual({ value: "Europe/Paris" })
      })

      it("still reports an Account that is neither on the target nor invited as not restored", async () => {
        testDb.prepare(
          `INSERT INTO favourites (user_uid, person_id, action_kind, medication_id, observation_type, default_value, label, sort_order)
           VALUES ('local:4', 1, 'observation', NULL, 'Hydration', '250', 'Writer water', 0)`,
        ).run()
        const zip = await exportHousehold()
        targetWithManager(null)
        const { plan } = await stageAndPlan(zip)
        const writer = (plan.accounts as { items: { email: string; bundle_id: number }[] }).items.find(row => row.email === "writer@example.com")!
        const { res } = await applyHousehold(zip, [{ bundle_id: writer.bundle_id, included: false }])
        expect(res.status).toBe(200)
        const body = await res.json() as { favourites: { not_restored: { reason: string; count: number }[] } }
        expect(body.favourites.not_restored).toContainEqual({ reason: "account not restored", count: 1 })
        expect(testDb.prepare("SELECT COUNT(*) AS n FROM favourites").get()).toEqual({ n: 0 })
      })
    })

    it("never applies sign-in settings from an export", async () => {
      const zip = await withSettings(await exportHousehold(), [
        { key: "auth.entra.enabled", value: "true" },
        { key: "auth.entra.client_id", value: "from-the-file" },
        { key: "auth.entra.tenant_id", value: "from-the-file" },
      ])
      freshInstance(true)
      const { plan } = await stageAndPlan(zip)
      const settingsPlan = plan.settings as { applied: { key: string }[]; skipped: { key: string; reason: string }[] }
      expect(settingsPlan.applied.map(row => row.key).filter(key => key.startsWith("auth."))).toEqual([])
      expect(settingsPlan.skipped).toEqual(expect.arrayContaining([
        { key: "auth.entra.enabled", reason: "sign_in" },
        { key: "auth.entra.client_id", reason: "sign_in" },
      ]))
      const { res } = await applyHousehold(zip)
      expect(res.status).toBe(200)
      expect(testDb.prepare("SELECT key FROM app_settings WHERE key LIKE 'auth.%'").all()).toEqual([])
    })

    it("keeps a setting the target already has, lists it in the preview, and never applies secrets or locked settings", async () => {
      const now = Date.now()
      testDb.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
        "locale.default_timezone", "Europe/London", now,
      )
      testDb.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
        "locale.measurement_system", "imperial", now,
      )
      testDb.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
        "schedule.lead_minutes", "45", now,
      )
      testDb.prepare(
        "INSERT INTO user_settings (user_uid, key, value, updated_at) VALUES ('local:2', 'locale.timezone', 'Australia/Sydney', ?)",
      ).run(now)
      const zip = await withSettings(await exportHousehold(), [
        { key: "email.smtp.password", value: "from-the-file" },
        { key: "push.vapid_private_key", value: "not-a-real-vapid-private-key" },
        { key: "security.mfa_required", value: "true" },
      ])

      freshInstance(true)
      testDb.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
        "locale.default_timezone", "Australia/Adelaide", Date.now(),
      )
      const previousLead = process.env.FC_SCHEDULE_LEAD_MINUTES
      process.env.FC_SCHEDULE_LEAD_MINUTES = "90"
      try {
        const { plan } = await stageAndPlan(zip)
        expect(plan.settings).toMatchObject({
          per_user: "not restored",
          differences: expect.arrayContaining([
            expect.objectContaining({ key: "locale.default_timezone", existing: "Australia/Adelaide", export: "Europe/London", reason: "kept" }),
            expect.objectContaining({ key: "schedule.lead_minutes", existing: "90", export: "45", reason: "locked" }),
          ]),
          skipped: expect.arrayContaining([
            expect.objectContaining({ key: "email.smtp.password", reason: "secret" }),
            expect.objectContaining({ key: "push.vapid_private_key", reason: "secret" }),
            expect.objectContaining({ key: "security.mfa_required", reason: "platform_locked" }),
          ]),
        })
        const settingsPlan = plan.settings as {
          applied: { key: string; value: string }[]
          differences: { key: string }[]
          skipped: { key: string; value?: string }[]
        }
        expect(settingsPlan.applied).toContainEqual({ key: "locale.measurement_system", value: "imperial" })
        expect(settingsPlan.differences.map(row => row.key)).not.toContain("email.smtp.password")
        expect(settingsPlan.skipped.every(row => row.value == null)).toBe(true)

        const { res } = await applyHousehold(zip)
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.settings).toMatchObject({
          per_user: "not restored",
          differences: expect.arrayContaining([
            expect.objectContaining({ key: "locale.default_timezone", existing: "Australia/Adelaide", reason: "kept" }),
          ]),
        })

        signInAsAdmin()
        const { GET: readSettings } = await import("@/app/api/app-settings/route")
        const listed = await (await readSettings()).json() as {
          settings: { key: string; value: string; source: string; secret: boolean; secretSet: boolean }[]
        }
        const byKey = (key: string) => listed.settings.find(row => row.key === key)
        expect(byKey("locale.default_timezone")).toMatchObject({ value: "Australia/Adelaide", source: "db" })
        expect(byKey("locale.measurement_system")).toMatchObject({ value: "imperial", source: "db" })
        expect(byKey("schedule.lead_minutes")).toMatchObject({ value: "90", source: "env" })
        expect(byKey("security.mfa_required")).toMatchObject({ value: "false", source: "default" })
        expect(byKey("email.smtp.password")).toMatchObject({ secret: true, secretSet: true })
        expect(byKey("push.vapid_private_key")).toMatchObject({ secret: true, secretSet: false })

        const samMail = sentMails.find(mail => mail.to === "sam@example.com")
        const token = samMail!.text.match(/accept-invite#token=(\S+)/)![1]
        const { POST: accept } = await import("@/app/api/accounts/invites/accept/route")
        expect((await accept(new NextRequest("http://localhost/api/accounts/invites/accept", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, password: "long-password", confirmPassword: "long-password" }),
        }))).status).toBe(200)
        const { GET: listPeople } = await import("@/app/api/people/route")
        const people = await (await listPeople(new NextRequest("http://localhost/api/people?include_inactive=1"))).json() as {
          name: string
          account_uid: string | null
        }[]
        const samUid = people.find(person => person.name === "Sam")?.account_uid
        session = { user: { id: samUid!, email: "sam@example.com" }, sessionVersion: 0 }
        const { GET: readTimezone } = await import("@/app/api/me/timezone/route")
        expect(await (await readTimezone()).json()).toEqual({
          timezone: "Australia/Sydney",
          effective: { tz: "Australia/Sydney", source: "user" },
        })

        delete process.env.FC_SCHEDULE_LEAD_MINUTES
        signInAsAdmin()
        const afterUnlock = await (await readSettings()).json() as typeof listed
        expect(afterUnlock.settings.find(row => row.key === "schedule.lead_minutes")).toMatchObject({
          value: "60",
          source: "default",
        })
      } finally {
        if (previousLead === undefined) delete process.env.FC_SCHEDULE_LEAD_MINUTES
        else process.env.FC_SCHEDULE_LEAD_MINUTES = previousLead
      }
    })

    it("adds nothing when the same restore is run again", async () => {
      const now = Date.now()
      testDb.prepare(
        `INSERT INTO favourites (user_uid, person_id, action_kind, medication_id, label, sort_order)
         VALUES ('local:2', 1, 'medication', 10, 'Morning dose', 0),
                ('local:2', 1, 'observation', NULL, 'Water', 1)`,
      ).run()
      testDb.prepare("UPDATE favourites SET observation_type = 'Hydration', default_value = '250' WHERE label = 'Water'").run()
      testDb.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('locale.default_timezone', 'Europe/London', ?)").run(now)
      testDb.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('locale.measurement_system', 'imperial', ?)").run(now)
      const zip = await exportHousehold()
      freshInstance(true)

      const first = await applyHousehold(zip)
      expect(first.res.status).toBe(200)
      const firstBody = await first.res.json()
      expect(firstBody.favourites).toMatchObject({ created: 2, duplicates: 0 })
      expect(firstBody.settings.applied).toEqual(expect.arrayContaining([
        { key: "locale.default_timezone", value: "Europe/London" },
        { key: "locale.measurement_system", value: "imperial" },
      ]))

      const second = await applyHousehold(zip)
      expect(second.res.status).toBe(200)
      const secondBody = await second.res.json()
      expect(secondBody.favourites).toMatchObject({ created: 0, duplicates: 2 })
      expect(secondBody.settings.applied).toEqual([])
      expect(secondBody.counts.new).toBe(0)

      const { GET: readSettings } = await import("@/app/api/app-settings/route")
      const listed = await (await readSettings()).json() as { settings: { key: string; value: string }[] }
      expect(listed.settings.find(row => row.key === "locale.default_timezone")?.value).toBe("Europe/London")
      expect(listed.settings.find(row => row.key === "locale.measurement_system")?.value).toBe("imperial")

      const { GET: listPeople } = await import("@/app/api/people/route")
      const people = await (await listPeople(new NextRequest("http://localhost/api/people?include_inactive=1"))).json() as {
        name: string
        account_uid: string | null
      }[]
      const samUid = people.find(person => person.name === "Sam")?.account_uid
      session = { user: { id: samUid!, email: "sam@example.com" }, sessionVersion: 0 }
      const { GET: listFavourites } = await import("@/app/api/favourites/route")
      const favourites = await (await listFavourites()).json() as { label: string | null }[]
      expect(favourites.map(row => row.label).sort()).toEqual(["Morning dose", "Water"])
    })
  })

  describe("per-user settings", () => {
    function settingsFor(uid: string): { key: string; value: string }[] {
      return testDb.prepare(
        "SELECT key, value FROM user_settings WHERE user_uid = ? ORDER BY key",
      ).all(uid) as { key: string; value: string }[]
    }

    it("applies household settings onto pending Invites and drops an invalid timezone", async () => {
      const now = Date.now()
      testDb.exec(`
        INSERT INTO user_settings (user_uid, key, value, updated_at) VALUES
          ('local:2', 'locale.timezone', 'Not/AZone', ${now}),
          ('local:2', 'hydration.active_start', '08:30', ${now}),
          ('local:2', 'hydration.active_end', '20:15', ${now}),
          ('local:2', 'hydration.glass_size', '300', ${now}),
          ('local:2', 'hydration.muted_until', '2099-01-01T00:00:00.000Z', ${now});
        INSERT INTO person_notification_prefs
          (person_id, user_uid, notify_prn, notify_prescribed, notify_overdue, notify_observations, notify_hydration)
          VALUES (2, 'local:2', 0, 1, 1, 1, 0);
      `)
      const zip = await exportHousehold()
      freshInstance(true)
      const { res } = await applyHousehold(zip)
      expect(res.status).toBe(200)
      const body = await res.json() as { user_settings: { lines: string[]; dropped_invalid: number } }
      expect(body.user_settings.dropped_invalid).toBe(1)
      expect(body.user_settings.lines).toEqual(expect.arrayContaining([
        "Applied hydration pacing.",
        "Applied notification preferences.",
        "Dropped 1 invalid per-user setting.",
      ]))
      expect(body.user_settings.lines).not.toContain("Applied timezone.")
      const samInvite = testDb.prepare("SELECT id FROM accounts WHERE email = 'sam@example.com'").get() as { id: number }
      const samUid = `local:${samInvite.id}`
      expect(settingsFor(samUid)).toEqual([
        { key: "hydration.active_end", value: "20:15" },
        { key: "hydration.active_start", value: "08:30" },
        { key: "hydration.glass_size", value: "300" },
      ])
      expect(testDb.prepare(
        "SELECT notify_prn, notify_observations, notify_hydration FROM person_notification_prefs WHERE user_uid = ?",
      ).get(samUid)).toEqual({ notify_prn: 0, notify_observations: 1, notify_hydration: 0 })
      const audit = testDb.prepare(
        "SELECT details FROM audit_log WHERE action = 'RESTORE'",
      ).get() as { details: string }
      expect(JSON.parse(audit.details).user_settings).toEqual({
        timezone: 0, hydration: 1, notifications: 1, kept: 0, dropped_invalid: 1,
      })
    })

    it("does not apply hydration when that Person is skipped, and still applies the Account timezone", async () => {
      const now = Date.now()
      testDb.exec(`
        UPDATE accounts SET role = 'write' WHERE id = 2;
        INSERT INTO user_settings (user_uid, key, value, updated_at) VALUES
          ('local:2', 'locale.timezone', 'Australia/Adelaide', ${now}),
          ('local:2', 'hydration.active_start', '08:30', ${now}),
          ('local:2', 'hydration.active_end', '20:15', ${now}),
          ('local:2', 'hydration.glass_size', '300', ${now});
      `)
      const zip = await exportHousehold()
      freshInstance(true)
      const { id, plan } = await stageAndPlan(zip)
      const { POST } = await import("@/app/api/restore/[id]/apply/route")
      const res = await POST(new NextRequest(`http://localhost/api/restore/${id}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          persons: plan.persons.map(person => (
            person.name === "Sam"
              ? { bundle_id: person.bundle_id, action: "skip", target_id: null }
              : { bundle_id: person.bundle_id, action: person.suggested_action, target_id: person.target_id }
          )),
          medications: plan.medications.map(medication => ({
            bundle_id: medication.bundle_id, action: medication.suggested_action, target_id: medication.target_id,
          })),
        }),
      }), { params: Promise.resolve({ id }) })
      expect(res.status).toBe(200)
      const body = await res.json() as { user_settings: { lines: string[] } }
      expect(body.user_settings.lines).toContain("Applied timezone.")
      expect(body.user_settings.lines).not.toContain("Applied hydration pacing.")
      const samInvite = testDb.prepare("SELECT id FROM accounts WHERE email = 'sam@example.com'").get() as { id: number }
      expect(settingsFor(`local:${samInvite.id}`)).toEqual([{ key: "locale.timezone", value: "Australia/Adelaide" }])
    })

    async function applyPerson(
      bytes: Buffer,
      signIn: { email: string; role?: string },
    ) {
      const { id, plan } = await stageAndPlan(bytes)
      const { POST } = await import("@/app/api/restore/[id]/apply/route")
      const res = await POST(new NextRequest(`http://localhost/api/restore/${id}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          persons: plan.persons.map(person => ({
            bundle_id: person.bundle_id, action: person.suggested_action, target_id: person.target_id,
          })),
          medications: plan.medications.map(medication => ({
            bundle_id: medication.bundle_id, action: medication.suggested_action, target_id: medication.target_id,
          })),
          person_sign_ins: plan.persons.map(person => ({
            bundle_id: person.bundle_id,
            email: signIn.email,
            role: signIn.role ?? "none",
          })),
        }),
      }), { params: Promise.resolve({ id }) })
      return res
    }

    it("says so and writes nothing when the Person Sign-in field is left blank", async () => {
      testDb.prepare(
        "INSERT INTO user_settings (user_uid, key, value, updated_at) VALUES ('local:4', 'locale.timezone', 'Australia/Adelaide', ?)",
      ).run(Date.now())
      testDb.prepare("UPDATE people SET account_uid = 'local:4' WHERE id = 1").run()
      const { GET } = await import("@/app/api/people/[id]/export/route")
      const exported = await GET(new NextRequest("http://localhost/api/people/1/export"), {
        params: Promise.resolve({ id: "1" }),
      })
      const zip = Buffer.from(await exported.arrayBuffer())
      freshInstance(true)
      const res = await applyZip(zip)
      expect(res.res.status).toBe(200)
      const body = await res.res.json() as { user_settings: { lines: string[]; applied: { timezone: number } } }
      expect(body.user_settings.lines).toContain("personal settings not carried: no sign-in given")
      expect(body.user_settings.applied.timezone).toBe(0)
      expect(testDb.prepare("SELECT COUNT(*) AS n FROM user_settings").get()).toEqual({ n: 0 })
      expect(testDb.prepare("SELECT COUNT(*) AS n FROM accounts WHERE email != 'admin@example.com'").get()).toEqual({ n: 0 })
    })

    it("creates an unsent Invite when outbound email is not configured, and sends one when it is", async () => {
      testDb.prepare("UPDATE people SET account_uid = 'local:4' WHERE id = 1").run()
      testDb.prepare(
        "INSERT INTO user_settings (user_uid, key, value, updated_at) VALUES ('local:4', 'locale.timezone', 'Australia/Adelaide', ?)",
      ).run(Date.now())
      const { GET } = await import("@/app/api/people/[id]/export/route")
      const exported = await GET(new NextRequest("http://localhost/api/people/1/export"), {
        params: Promise.resolve({ id: "1" }),
      })
      const zip = Buffer.from(await exported.arrayBuffer())

      emailConfigured = false
      freshInstance(false)
      const unsent = await applyPerson(zip, { email: "new-person@example.com", role: "read" })
      expect(unsent.status).toBe(200)
      const unsentBody = await unsent.json() as { user_settings: { lines: string[] } }
      expect(unsentBody.user_settings.lines).toContain(
        "The invite was created but not sent. Send it later from Administration → Accounts.",
      )
      expect(sendOutboundEmailCalls).toBe(0)
      const invited = testDb.prepare(
        "SELECT role, status, auth_method, password_hash FROM accounts WHERE email = 'new-person@example.com'",
      ).get() as { role: string; status: string; auth_method: string; password_hash: string | null }
      expect(invited).toMatchObject({ role: "read", status: "invited", auth_method: "local", password_hash: null })
      const linked = testDb.prepare(
        "SELECT account_uid FROM people WHERE name = 'Alex'",
      ).get() as { account_uid: string }
      expect(settingsFor(linked.account_uid)).toEqual([{ key: "locale.timezone", value: "Australia/Adelaide" }])

      emailConfigured = true
      sendOutboundEmailCalls = 0
      freshInstance(true)
      const sent = await applyPerson(zip, { email: "another@example.com" })
      expect(sent.status).toBe(200)
      expect(sendOutboundEmailCalls).toBe(1)
      expect(sentMails.some(mail => mail.to === "another@example.com")).toBe(true)
      const noneRole = testDb.prepare(
        "SELECT role FROM accounts WHERE email = 'another@example.com'",
      ).get() as { role: string }
      expect(noneRole.role).toBe("none")
    })

    it("links an existing Account that has no Personal-link and does not overwrite settings it already has", async () => {
      testDb.prepare("UPDATE people SET account_uid = 'local:4' WHERE id = 1").run()
      const now = Date.now()
      testDb.prepare(
        `INSERT INTO user_settings (user_uid, key, value, updated_at) VALUES
          ('local:4', 'locale.timezone', 'Australia/Sydney', ?),
          ('local:4', 'hydration.glass_size', '300', ?)`,
      ).run(now, now)
      const { GET } = await import("@/app/api/people/[id]/export/route")
      const exported = await GET(new NextRequest("http://localhost/api/people/1/export"), {
        params: Promise.resolve({ id: "1" }),
      })
      const zip = Buffer.from(await exported.arrayBuffer())
      freshInstance(true)
      testDb.prepare(
        "INSERT INTO accounts (id, email, role, status, auth_method) VALUES (8, 'care@example.com', 'write', 'active', 'local')",
      ).run()
      testDb.prepare(
        "INSERT INTO user_settings (user_uid, key, value, updated_at) VALUES ('local:8', 'locale.timezone', 'Europe/London', ?)",
      ).run(Date.now())
      const beforeMails = sendOutboundEmailCalls
      const res = await applyPerson(zip, { email: "care@example.com" })
      expect(res.status).toBe(200)
      expect(sendOutboundEmailCalls).toBe(beforeMails)
      const body = await res.json() as { user_settings: { lines: string[]; kept: number } }
      expect(body.user_settings.lines).toContain("Linked the existing Account. No invite was sent.")
      expect(body.user_settings.lines).toContain("Kept 1 per-user setting this instance already has.")
      expect(body.user_settings.lines).toContain("Applied hydration pacing.")
      expect(settingsFor("local:8")).toEqual([
        { key: "hydration.glass_size", value: "300" },
        { key: "locale.timezone", value: "Europe/London" },
      ])
      expect(testDb.prepare("SELECT account_uid FROM people WHERE name = 'Alex'").get()).toEqual({ account_uid: "local:8" })
    })

    it("refuses an Account that already has a Personal-link to someone else", async () => {
      testDb.prepare("UPDATE people SET account_uid = 'local:4' WHERE id = 1").run()
      const { GET } = await import("@/app/api/people/[id]/export/route")
      const exported = await GET(new NextRequest("http://localhost/api/people/1/export"), {
        params: Promise.resolve({ id: "1" }),
      })
      const zip = Buffer.from(await exported.arrayBuffer())
      freshInstance(true)
      testDb.exec(`
        INSERT INTO accounts (id, email, role, status, auth_method) VALUES (8, 'taken@example.com', 'write', 'active', 'local');
        INSERT INTO people (id, name, account_uid, color) VALUES (9, 'Blake', 'local:8', '#111111');
      `)
      const res = await applyPerson(zip, { email: "taken@example.com" })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({
        error: "This account already has a Personal-link to someone else.",
        sign_in_bundle_id: 1,
      })
      expect(testDb.prepare("SELECT name FROM people ORDER BY id").all()).toEqual([
        { name: "Blake" },
      ])
    })

    it("sends the invite on an Entra instance too, and creates no password until they accept", async () => {
      testDb.prepare("UPDATE people SET account_uid = 'local:4' WHERE id = 1").run()
      testDb.prepare(
        "INSERT INTO user_settings (user_uid, key, value, updated_at) VALUES ('local:4', 'locale.timezone', 'Australia/Adelaide', ?)",
      ).run(Date.now())
      const { GET } = await import("@/app/api/people/[id]/export/route")
      const exported = await GET(new NextRequest("http://localhost/api/people/1/export"), {
        params: Promise.resolve({ id: "1" }),
      })
      const zip = Buffer.from(await exported.arrayBuffer())
      freshInstance(true)
      const now = Date.now()
      testDb.prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES
          ('auth.entra.enabled', 'true', ?),
          ('auth.entra.client_id', 'cid', ?),
          ('auth.entra.tenant_id', 'tid', ?),
          ('auth.entra.client_secret', 'sec', ?)`,
      ).run(now, now, now, now)
      const before = sendOutboundEmailCalls
      const res = await applyPerson(zip, { email: "entra-person@example.com" })
      expect(res.status).toBe(200)
      expect(sendOutboundEmailCalls).toBe(before + 1)
      const body = await res.json() as { user_settings: { lines: string[] } }
      expect(body.user_settings.lines).toContain(
        "This instance also uses Entra sign-in — they can set a password from the invite, or sign in with Entra using the same email.",
      )
      const row = testDb.prepare(
        "SELECT status, auth_method, password_hash FROM accounts WHERE email = 'entra-person@example.com'",
      ).get() as { status: string; auth_method: string; password_hash: string | null }
      expect(row).toEqual({ status: "invited", auth_method: "local", password_hash: null })
    })

    it("applies a lower format version that has no per-user section", async () => {
      freshInstance(true)
      const bytes = await zipEntries([{
        name: "manifest.json",
        content: JSON.stringify({
          format_version: 1, scope: "person", app_version: "1.0.0", exported_at: "2026-01-01T00:00:00.000Z",
          sections: ["person"], counts: { person: 1 }, skipped_files: [],
        }),
      }, {
        name: "person.json",
        content: JSON.stringify({
          person: { id: 1, db_id: 1, name: "Pat", full_name: null, date_of_birth: null, color: "#256AA5", is_active: 1, photo: null },
          medications: [], assignments: [], administrations: [], observations: [], test_results: [], symptoms: [],
          symptom_dose_links: [], observation_goals: [], observation_expectations: [],
          catalogues: { observation_types: [], test_metrics: [] },
        }),
      }])
      const res = await applyZip(bytes)
      expect(res.res.status).toBe(200)
      const body = await res.res.json() as { user_settings: unknown }
      expect(body.user_settings).toBe("not restored")
      expect(testDb.prepare("SELECT COUNT(*) AS n FROM user_settings").get()).toEqual({ n: 0 })
    })
  })
})

async function tamperPersonJson(bytes: Buffer, edit: (payload: Record<string, unknown>) => void): Promise<Buffer> {
  const { execFileSync } = await import("child_process")
  const dir = mkdtempSync(join(tmpdir(), "fc-tamper-"))
  const zipPath = join(dir, "in.zip")
  writeFileSync(zipPath, bytes)
  const manifest = execFileSync("unzip", ["-p", zipPath, "manifest.json"], { encoding: "utf8" })
  const payload = JSON.parse(execFileSync("unzip", ["-p", zipPath, "person.json"], { encoding: "utf8" })) as Record<string, unknown>
  edit(payload)
  return zipEntries([
    { name: "manifest.json", content: manifest },
    { name: "person.json", content: JSON.stringify(payload) },
  ])
}

async function withSettings(bytes: Buffer, extra: { key: string; value: string }[]): Promise<Buffer> {
  const { execFileSync } = await import("child_process")
  const { readFileSync, writeFileSync, readdirSync, statSync } = await import("fs")
  const dir = mkdtempSync(join(tmpdir(), "fc-settings-"))
  const zipPath = join(dir, "in.zip")
  writeFileSync(zipPath, bytes)
  execFileSync("unzip", ["-q", "-d", join(dir, "out"), zipPath])
  const payloadPath = join(dir, "out", "household.json")
  const payload = JSON.parse(readFileSync(payloadPath, "utf8")) as { settings: { key: string; value: string }[] }
  payload.settings.push(...extra)
  writeFileSync(payloadPath, JSON.stringify(payload))
  const entries: { name: string; content: Buffer }[] = []
  const walk = (folder: string, prefix: string) => {
    for (const name of readdirSync(folder)) {
      const full = join(folder, name)
      const rel = prefix ? `${prefix}/${name}` : name
      if (statSync(full).isDirectory()) walk(full, rel)
      else entries.push({ name: rel, content: readFileSync(full) })
    }
  }
  walk(join(dir, "out"), "")
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } })
    const chunks: Buffer[] = []
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk))
        cb()
      },
    })
    archive.on("error", reject)
    sink.on("error", reject)
    sink.on("finish", () => resolve(Buffer.concat(chunks)))
    archive.pipe(sink)
    for (const entry of entries) archive.append(entry.content, { name: entry.name })
    void archive.finalize()
  })
}
