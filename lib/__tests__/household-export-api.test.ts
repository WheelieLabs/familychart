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
import { exportsInFlight } from "@/lib/export/export-registry"
import { __setUploadBlobAdapterForTests, createMemoryUploadBlobAdapter, deleteUpload } from "@/lib/uploads/store"
import type { ExportManifest } from "@/lib/export/export-manifest"
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

async function exportHouseholdSize() {
  const { GET } = await import("@/app/api/export/household/size/route")
  const res = await GET()
  responses.push(res)
  return res
}

async function exportHousehold() {
  const { GET } = await import("@/app/api/export/household/route")
  const res = await GET(new NextRequest("http://localhost/api/export/household"))
  responses.push(res)
  return res
}

async function exportPerson(personId: number) {
  const { GET } = await import("@/app/api/people/[id]/export/route")
  const res = await GET(new NextRequest(`http://localhost/api/people/${personId}/export`), {
    params: Promise.resolve({ id: String(personId) }),
  })
  responses.push(res)
  return res
}

async function abandonUnreadDownloads() {
  for (const res of responses.splice(0)) {
    if (res.body && !res.body.locked) await res.body.cancel()
  }
}

class ExportZip {
  constructor(private readonly path: string) {}

  names(): string[] {
    return execFileSync("unzip", ["-Z1", this.path], { encoding: "utf8" }).trim().split("\n").filter(Boolean)
  }

  text(name: string): string {
    return execFileSync("unzip", ["-p", this.path, name], { encoding: "utf8" })
  }

  json<T>(name: string): T {
    return JSON.parse(this.text(name)) as T
  }
}

async function readZip(res: Response): Promise<ExportZip> {
  const dir = mkdtempSync(join(tmpdir(), "fc-household-export-"))
  const path = join(dir, "export.zip")
  writeFileSync(path, Buffer.from(await res.arrayBuffer()))
  return new ExportZip(path)
}

describe("GET /api/export/household/size", () => {
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

  it("estimates the download from the photo and report bytes an Admin would receive", async () => {
    const res = await exportHouseholdSize()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ bytes: 29, reportBytes: 14 })
    signInAs(3, "manager@example.com")
    expect((await exportHouseholdSize()).status).toBe(403)
  })
})

describe("GET /api/export/household", () => {
  beforeEach(async () => {
    testDb = new Database(":memory:")
    applyBaselineSchema(testDb)
    __setUploadBlobAdapterForTests(createMemoryUploadBlobAdapter())
    await seedExportHousehold(testDb)
    signInAs(1, "admin@example.com")
    testDb.exec(`
      INSERT INTO medication_groups (id, name, notes, is_active) VALUES
        (1, 'Pain relief', 'Analgesics', 1),
        (2, 'Sleep', NULL, 0);
      INSERT INTO medication_group_members (medication_id, group_id) VALUES
        (10, 1), (11, 1), (12, 2);
    `)
  })

  afterEach(async () => {
    await abandonUnreadDownloads()
    testDb.close()
    __setUploadBlobAdapterForTests(null)
    vi.clearAllMocks()
  })

  it("opens with a household manifest and the shared medication catalogue, including groups and unused medicines", async () => {
    const res = await exportHousehold()
    expect(res.status).toBe(200)
    const zip = await readZip(res)
    expect(zip.names()[0]).toBe("manifest.json")
    expect(zip.json("manifest.json")).toMatchObject({
      format_version: 2,
      scope: "household",
      app_version: APP_VERSION,
    })

    const household = zip.json<{
      medications: Array<{
        name: string
        is_active: number
        group_ids: number[]
        frequency_rules: Array<{ min_hours_between: number }>
      }>
      groups: Array<{ id: number; name: string; notes: string | null; is_active: number }>
    }>("household.json")

    expect(household.groups).toEqual([
      { id: 1, db_id: 1, name: "Pain relief", notes: "Analgesics", is_active: 1 },
      { id: 2, db_id: 2, name: "Sleep", notes: null, is_active: 0 },
    ])
    const byName = Object.fromEntries(household.medications.map(m => [m.name, m]))
    expect(Object.keys(byName).sort()).toEqual(["Ibuprofen", "Melatonin", "Paracetamol", "Unused"])
    expect(byName.Paracetamol).toMatchObject({
      is_active: 1,
      group_ids: [1],
      frequency_rules: [{ min_hours_between: 4 }],
    })
    expect(byName.Ibuprofen).toMatchObject({ is_active: 0, group_ids: [1] })
    expect(byName.Melatonin.group_ids).toEqual([2])
    expect(byName.Unused).toMatchObject({ is_active: 1, group_ids: [], frequency_rules: [] })
  })

  it("carries each Person's slot outcomes in their payload and counts them in the manifest", async () => {
    const household = await readZip(await exportHousehold())
    const outcomes = [1, 2, 3].map(
      index => household.json<{ slot_outcomes: unknown[] }>(`people/${index}/person.json`).slot_outcomes.length,
    )
    expect(outcomes).toEqual([2, 1, 0])
    let personRecords = 0
    for (const dbId of [1, 2, 3]) {
      const counts = (await readZip(await exportPerson(dbId))).json<ExportManifest>("manifest.json").counts
      expect(counts.slot_outcomes).toBe(outcomes[dbId - 1])
      for (const [section, value] of Object.entries(counts)) {
        if (!["person", "attachments"].includes(section)) personRecords += value
      }
    }
    const counts = household.json<ExportManifest>("manifest.json").counts
    expect(counts.person_records).toBe(personRecords)
    expect(personRecords).toBeGreaterThanOrEqual(3)
  })

  it("describes Accounts as invites with a bundle-local Personal-link and no credential or device state", async () => {
    testDb.exec(`
      UPDATE accounts SET password_hash = '$2b$10$householdExportHash', totp_secret = 'JBSWY3DPEHPK3PXPHOUSEHOLD',
        invite_token_hash = 'invite-token-hash-household' WHERE id = 1;
      INSERT INTO accounts (id, email, role, can_report, is_active, auth_method, external_id, password_hash)
        VALUES (6, 'entra@example.com', 'read', 1, 0, 'entra', 'oid-entra-1', NULL);
      UPDATE people SET account_uid = 'oid-entra-1' WHERE id = 3;
      INSERT INTO push_endpoints (user_uid, endpoint, p256dh, web_push_auth)
        VALUES ('local:1', 'https://push.example.invalid/household', 'push-p256dh-household-key', 'push-auth-household-key');
      INSERT INTO user_settings (user_uid, key, value, updated_at)
        VALUES ('local:1', 'hydration.mute', 'user-setting-marker-household', 1);
      INSERT INTO audit_log (user_email, action, entity_type, details)
        VALUES ('admin@example.com', 'UPDATE', 'people', 'audit-marker-household');
    `)

    const zip = await readZip(await exportHousehold())
    const household = zip.json<{
      accounts: Array<{
        id: number
        email: string
        role: string
        can_report: number
        is_active: number
        auth_method: string
        person_id: number | null
      }>
    }>("household.json")

    expect(household.accounts.map(({ id: _id, ...account }) => account)).toEqual([
      { db_id: 1, email: "admin@example.com", role: "admin", can_report: 0, is_active: 1, auth_method: "local", person_id: null },
      { db_id: 2, email: "sam@example.com", role: "none", can_report: 0, is_active: 1, auth_method: "local", person_id: 2 },
      { db_id: 3, email: "manager@example.com", role: "manage", can_report: 0, is_active: 1, auth_method: "local", person_id: null },
      { db_id: 4, email: "writer@example.com", role: "write", can_report: 0, is_active: 1, auth_method: "local", person_id: null },
      { db_id: 5, email: "unlinked@example.com", role: "none", can_report: 0, is_active: 1, auth_method: "local", person_id: null },
      { db_id: 6, email: "entra@example.com", role: "read", can_report: 1, is_active: 0, auth_method: "entra", person_id: 3 },
    ])

    const archive = zip.names().map(name => zip.text(name)).join("\n")
    expect(archive).not.toContain("$2b$10$householdExportHash")
    expect(archive).not.toContain("JBSWY3DPEHPK3PXPHOUSEHOLD")
    expect(archive).not.toContain("invite-token-hash-household")
    expect(archive).not.toContain("push-p256dh-household-key")
    expect(archive).not.toContain("push-auth-household-key")
    expect(archive).not.toContain("oid-entra-1")
    expect(archive).not.toContain("user-setting-marker-household")
    expect(archive).not.toContain("audit-marker-household")
  })

  it("exports registry settings that are neither secret nor platform-locked, and the catalogue flags", async () => {
    testDb.exec(`
      INSERT INTO app_settings (key, value, updated_at) VALUES
        ('locale.default_timezone', 'Europe/London', 1),
        ('auth.entra.client_secret', 'entra-secret-household', 1),
        ('security.mfa_required', 'true', 1),
        ('email.smtp.host', 'smtp.example.invalid', 1),
        ('email.smtp.password', 'smtp-secret-household', 1),
        ('push.vapid_private_key', 'vapid-private-household', 1);
    `)
    const zip = await readZip(await exportHousehold())
    const household = zip.json<{
      settings: Array<{ key: string; value: string }>
      catalogues: { observation_types: Array<{ name: string; is_active: number }>; test_metrics: Array<{ name: string; is_active: number }> }
    }>("household.json")
    expect(household.settings).toEqual([
      { key: "locale.default_timezone", value: "Europe/London" },
      { key: "locale.measurement_system", value: "metric" },
      { key: "schedule.lead_minutes", value: "60" },
      { key: "schedule.overdue_offset_minutes", value: "30" },
      { key: "auth.entra.enabled", value: "false" },
      { key: "auth.entra.client_id", value: "" },
      { key: "auth.entra.tenant_id", value: "" },
      { key: "push.vapid_subject", value: "" },
      { key: "push.vapid_public_key", value: "" },
    ])
    expect(household.settings.map(s => s.key)).not.toContain("security.mfa_required")
    expect(household.settings.map(s => s.key)).not.toContain("email.smtp.host")
    expect(household.catalogues.observation_types).toContainEqual({ name: "Head Circumference", is_active: 0 })
    expect(household.catalogues.test_metrics).toEqual([{ name: "Ferritin", is_active: 1 }, { name: "Iron", is_active: 0 }])
    const archive = zip.names().map(name => zip.text(name)).join("\n")
    expect(archive).not.toContain("entra-secret-household")
    expect(archive).not.toContain("smtp-secret-household")
    expect(archive).not.toContain("vapid-private-household")
  })

  it("records Favourites against bundle-local Account, Person and medication ids", async () => {
    testDb.exec(`
      INSERT INTO favourites (user_uid, person_id, action_kind, medication_id, observation_type, default_value, label, sort_order) VALUES
        ('local:2', 2, 'medication', 12, NULL, NULL, 'Bedtime', 1),
        ('local:1', 1, 'observation', NULL, 'Weight', '21.5', 'Weigh in', 0);
    `)
    const household = (await readZip(await exportHousehold())).json<{
      favourites: Array<Record<string, unknown>>
    }>("household.json")
    expect(household.favourites).toEqual([
      {
        account_id: 1, person_id: 1, action_kind: "observation", medication_id: null,
        observation_type: "Weight", default_value: "21.5", label: "Weigh in", sort_order: 0,
      },
      {
        account_id: 2, person_id: 2, action_kind: "medication", medication_id: 2,
        observation_type: null, default_value: null, label: "Bedtime", sort_order: 1,
      },
    ])
  })

  it("carries durable per-user settings under bundle-local ids and leaves identity, transient hydration and push subscriptions out", async () => {
    testDb.exec(`
      INSERT INTO user_settings (user_uid, key, value, updated_at) VALUES
        ('local:2', 'locale.timezone', 'Australia/Adelaide', 1),
        ('local:2', 'hydration.active_start', '08:30', 1),
        ('local:2', 'hydration.active_end', '20:15', 1),
        ('local:2', 'hydration.glass_size', '300', 1),
        ('local:2', 'hydration.muted_until', 'mute-marker-household', 1),
        ('local:2', 'hydration.last_nudge_at', 'nudge-marker-household', 1),
        ('local:2', 'hydration.last_record_at', 'record-marker-household', 1),
        ('local:1', 'locale.timezone', 'Europe/London', 1);
      INSERT INTO person_notification_prefs
        (person_id, user_uid, notify_prn, notify_prescribed, notify_overdue, notify_observations, notify_hydration)
        VALUES
          (2, 'local:2', 0, 1, 1, 1, 0),
          (1, 'local:2', 1, 0, 1, 0, 1),
          (2, 'local:1', 1, 1, 0, 1, 1);
      INSERT INTO push_endpoints (user_uid, endpoint, p256dh, web_push_auth)
        VALUES ('local:2', 'https://push.example.invalid/settings', 'push-p256dh-settings', 'push-auth-settings');
    `)
    const household = (await readZip(await exportHousehold())).json<{
      user_settings: Array<Record<string, unknown>>
    }>("household.json")
    expect(household.user_settings).toEqual([
      {
        account_id: 1,
        timezone: "Europe/London",
        notifications: [{
          person_id: 2,
          notify_prn: true,
          notify_prescribed: true,
          notify_overdue: false,
          notify_observations: true,
          notify_hydration: true,
        }],
      },
      {
        account_id: 2,
        timezone: "Australia/Adelaide",
        hydration: { person_id: 2, active_start: "08:30", active_end: "20:15", glass_size: "300" },
        notifications: [
          {
            person_id: 1,
            notify_prn: true,
            notify_prescribed: false,
            notify_overdue: true,
            notify_observations: false,
            notify_hydration: true,
          },
          {
            person_id: 2,
            notify_prn: false,
            notify_prescribed: true,
            notify_overdue: true,
            notify_observations: true,
            notify_hydration: false,
          },
        ],
      },
    ])
    const section = JSON.stringify(household.user_settings)
    expect(section).not.toContain("@")
    expect(section).not.toContain("local:")
    expect(section).not.toContain("mute-marker-household")
    expect(section).not.toContain("nudge-marker-household")
    expect(section).not.toContain("record-marker-household")
    expect(section).not.toContain("push-p256dh-settings")
    expect(section).not.toContain("push-auth-settings")
  })

  it("embeds each Person's standalone export in a folder named only with the bundle-local id", async () => {
    await deleteUpload("test-results", "88888888-8888-4888-8888-888888888888.pdf")
    const household = await readZip(await exportHousehold())
    expect(household.names().some(name => /alex|sam|robin/i.test(name))).toBe(false)
    for (const [dbId, folder] of [[1, "people/1"], [2, "people/2"], [3, "people/3"]] as const) {
      const standalone = await readZip(await exportPerson(dbId))
      for (const name of standalone.names()) {
        if (name === "manifest.json") continue
        expect(household.text(`${folder}/${name}`)).toBe(standalone.text(name))
      }
    }
    expect(household.json<ExportManifest>("manifest.json").skipped_files).toEqual([
      { path: "people/1/attachments/report-1.pdf", reason: "The report file is missing from storage" },
    ])
  })

  describe("who may export", () => {
    it("refuses anyone who is not an Admin", async () => {
      signInAs(2, "sam@example.com")
      expect((await exportHousehold()).status).toBe(403)
      signInAs(3, "manager@example.com")
      expect((await exportHousehold()).status).toBe(403)
      signInAs(4, "writer@example.com")
      expect((await exportHousehold()).status).toBe(403)
      signInAs(5, "unlinked@example.com")
      expect((await exportHousehold()).status).toBe(403)
    })

    it("refuses an anonymous request", async () => {
      session = null
      expect((await exportHousehold()).status).toBe(401)
    })
  })

  it("writes one audit entry with the scope, Person count and format version", async () => {
    await (await exportHousehold()).arrayBuffer()
    const rows = testDb.prepare("SELECT user_email, action, entity_type, entity_id, details FROM audit_log").all() as {
      user_email: string; action: string; entity_type: string; entity_id: number | null; details: string
    }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ user_email: "admin@example.com", action: "EXPORT", entity_type: "household", entity_id: null })
    const details = JSON.parse(rows[0].details) as { scope: string; person_count: number; format_version: number; counts: Record<string, number> }
    expect(details).toMatchObject({ scope: "household", person_count: 3, format_version: 2 })
    expect(details.counts.people).toBe(3)
    expect(JSON.stringify(details)).not.toContain("Alex")
    expect(JSON.stringify(details)).not.toContain("Paracetamol")
  })

  describe("exports in flight", () => {
    it("counts every Person until the household download finishes", async () => {
      const res = await exportHousehold()
      expect(exportsInFlight(1)).toBe(1)
      expect(exportsInFlight(2)).toBe(1)
      expect(exportsInFlight(3)).toBe(1)
      await res.arrayBuffer()
      expect(exportsInFlight(1)).toBe(0)
      expect(exportsInFlight(3)).toBe(0)
    })

    it("releases every Person when the download is abandoned", async () => {
      const res = await exportHousehold()
      const reader = res.body!.getReader()
      await reader.read()
      await reader.cancel()
      expect(exportsInFlight(1)).toBe(0)
      expect(exportsInFlight(2)).toBe(0)
      expect(exportsInFlight(3)).toBe(0)
    })
  })

  it("streams a large household export without holding it in memory", async () => {
    const REPORTS = 40
    const REPORT_BYTES = 8 * 1024 * 1024
    __setUploadBlobAdapterForTests({
      ...createMemoryUploadBlobAdapter(),
      get: async (bucket, filename) => (bucket === "test-results" ? Buffer.alloc(REPORT_BYTES, filename) : null),
      head: async (bucket, filename, n) => (bucket === "test-results" ? Buffer.alloc(n, filename) : null),
    })
    const insert = testDb.prepare(
      "INSERT INTO test_events (person_id, test_type, name, date, attachment_url) VALUES (1, 'Blood', ?, '2026-01-01', ?)",
    )
    for (let i = 0; i < REPORTS; i++) insert.run(`Result ${i}`, `/api/test-results/uploads/00000000-0000-4000-8000-${String(i).padStart(12, "0")}.pdf`)

    v8.setFlagsFromString("--expose-gc")
    const gc = vm.runInNewContext("gc") as () => void
    const retained = () => {
      gc()
      return process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers
    }
    const baseline = retained()
    let peak = baseline
    const res = await exportHousehold()
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
    expect(peak - baseline).toBeLessThan(8 * REPORT_BYTES)
  }, 60_000)
})
