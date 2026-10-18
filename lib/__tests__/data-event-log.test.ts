// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { mkdtempSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyBaselineSchema } from "@/lib/db"
import { logger } from "@/lib/logger"
import { __setRestoreStageDirForTests } from "@/lib/restore/stage-store"
import { syncTestMetricCatalogue } from "@/lib/test-results/test-metric-catalogue"
import { __setUploadBlobAdapterForTests, createMemoryUploadBlobAdapter } from "@/lib/uploads/store"
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
let stageDir: string

const APP_VERSION = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).version as string

/** Known personal values from the shared export fixture, plus a passphrase sent with apply. */
const PERSONAL = [
  "Alex",
  "Alex Example",
  "Sam",
  "Sam Example",
  "Robin",
  "Robin Example",
  "admin@example.com",
  "sam@example.com",
  "manager@example.com",
  "writer@example.com",
  "unlinked@example.com",
  "2015-04-02",
  "2001-09-30",
  "1950-01-01",
  "alex-photo.jpg",
  "88888888-8888-4888-8888-888888888888.pdf",
  "correct-horse-battery-staple",
  "After breakfast",
  "Paracetamol",
  "Headache",
]

const EVENTS = ["person_export", "household_export", "restore_applied", "person_erased", "account_removed"] as const

function signInAsAdmin() {
  session = { user: { id: "local:1", email: "admin@example.com" }, sessionVersion: 0 }
}

describe("export, restore and erase log lines", () => {
  beforeEach(async () => {
    stageDir = mkdtempSync(join(tmpdir(), "fc-data-event-log-"))
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

  it("emits one structured line per export, restore and erase, with no personal data", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => {})
    const error = vi.spyOn(logger, "error").mockImplementation(() => {})

    const { GET: exportPerson } = await import("@/app/api/people/[id]/export/route")
    const exported = await exportPerson(new NextRequest("http://localhost/api/people/1/export"), {
      params: Promise.resolve({ id: "1" }),
    })
    expect(exported.status).toBe(200)
    const zip = Buffer.from(await exported.arrayBuffer())

    const { GET: exportHousehold } = await import("@/app/api/export/household/route")
    const household = await exportHousehold(new NextRequest("http://localhost/api/export/household"))
    expect(household.status).toBe(200)
    await household.arrayBuffer()

    const exportAudit = testDb.prepare(
      "SELECT user_email, action, entity_type, entity_id, details FROM audit_log WHERE action = 'EXPORT' AND entity_type = 'people'",
    ).get() as { user_email: string; action: string; entity_type: string; entity_id: number; details: string }
    expect(exportAudit).toMatchObject({
      user_email: "admin@example.com", action: "EXPORT", entity_type: "people", entity_id: 1,
    })
    const householdAudit = testDb.prepare(
      "SELECT user_email, action, entity_type, entity_id, details FROM audit_log WHERE action = 'EXPORT' AND entity_type = 'household'",
    ).get() as { user_email: string; action: string; entity_type: string; entity_id: number | null; details: string }
    expect(householdAudit).toMatchObject({
      user_email: "admin@example.com", action: "EXPORT", entity_type: "household", entity_id: null,
    })
    expect(JSON.parse(householdAudit.details)).toMatchObject({
      scope: "household", person_count: 3, format_version: 2,
    })

    expect(JSON.parse(exportAudit.details)).toEqual({
      scope: "person",
      format_version: 2,
      counts: {
        person: 1, medications: 2, assignments: 2, administrations: 2, observations: 4, test_results: 1, symptoms: 1,
        symptom_dose_links: 1, observation_goals: 1, observation_expectations: 1, slot_outcomes: 2, attachments: 2,
      },
    })

    testDb.close()
    testDb = new Database(":memory:")
    applyBaselineSchema(testDb)
    syncTestMetricCatalogue(testDb)
    testDb.prepare("INSERT INTO accounts (id, email, role) VALUES (1, 'admin@example.com', 'admin')").run()

    const { POST: upload } = await import("@/app/api/restore/upload/route")
    const staged = await upload(new NextRequest("http://localhost/api/restore/upload", {
      method: "POST",
      body: new Uint8Array(zip),
      headers: { "content-type": "application/zip" },
    }))
    expect(staged.status).toBe(200)
    const { id } = await staged.json() as { id: string }

    const { GET: planRoute } = await import("@/app/api/restore/[id]/route")
    const planRes = await planRoute(new NextRequest(`http://localhost/api/restore/${id}`), {
      params: Promise.resolve({ id }),
    })
    expect(planRes.status).toBe(200)
    const plan = await planRes.json() as {
      persons: { bundle_id: number; suggested_action: string; target_id: number | null }[]
      medications: { bundle_id: number; suggested_action: string; target_id: number | null }[]
    }

    const { POST: apply } = await import("@/app/api/restore/[id]/apply/route")
    const applied = await apply(new NextRequest(`http://localhost/api/restore/${id}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        passphrase: "correct-horse-battery-staple",
        persons: plan.persons.map(person => ({
          bundle_id: person.bundle_id, action: person.suggested_action, target_id: person.target_id,
        })),
        medications: plan.medications.map(medication => ({
          bundle_id: medication.bundle_id, action: medication.suggested_action, target_id: medication.target_id,
        })),
      }),
    }), { params: Promise.resolve({ id }) })
    expect(applied.status).toBe(200)

    const restoreAudit = testDb.prepare(
      "SELECT action, entity_type, entity_id, details FROM audit_log WHERE action = 'RESTORE'",
    ).get() as { action: string; entity_type: string; entity_id: number | null; details: string }
    expect(restoreAudit).toMatchObject({ action: "RESTORE", entity_type: "restore", entity_id: null })
    expect(JSON.parse(restoreAudit.details)).toEqual({
      scope: "person",
      format_version: 2,
      app_version: APP_VERSION,
      counts: { new: 27, duplicate: 0, differing: 0, skipped: 0 },
      user_settings: { timezone: 0, hydration: 0, notifications: 0, kept: 0, dropped_invalid: 0 },
    })

    const restored = testDb.prepare("SELECT id FROM people").get() as { id: number }
    testDb.prepare("UPDATE people SET is_active = 0 WHERE id = ?").run(restored.id)
    const { POST: erase } = await import("@/app/api/people/[id]/erase/route")
    const erased = await erase(new NextRequest(`http://localhost/api/people/${restored.id}/erase`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }), { params: Promise.resolve({ id: String(restored.id) }) })
    expect(erased.status).toBe(200)

    const eraseAudit = testDb.prepare(
      "SELECT action, entity_type, details FROM audit_log WHERE action = 'ERASE'",
    ).get() as { action: string; entity_type: string; details: string }
    expect(eraseAudit).toMatchObject({ action: "ERASE", entity_type: "people" })
    expect(JSON.parse(eraseAudit.details)).toEqual({
      event: "Person erased",
      counts: {
        doses: 2, observations: 4, test_results: 1, symptoms: 1, symptom_links: 1, assignments: 2,
        dose_expectations: 1, slot_outcomes: 2, goals: 1, observation_expectations: 1, favourites: 0,
        notification_preferences: 0, notification_history: 0, push_dedupe: 0, files: 2,
      },
    })

    const lines = [...info.mock.calls, ...error.mock.calls].filter(call =>
      EVENTS.includes(call[0] as typeof EVENTS[number]),
    )
    const logged = JSON.stringify(lines)
    for (const needle of PERSONAL) expect(logged).not.toContain(needle)

    const of = (event: string) => lines.filter(call => call[0] === event)
    expect(of("person_export")).toHaveLength(1)
    expect(of("household_export")).toHaveLength(1)
    expect(of("restore_applied")).toHaveLength(1)
    expect(of("person_erased")).toHaveLength(1)

    expect(of("person_export")[0][1]).toEqual({
      event: "person_export",
      protected: false,
      actor_role: "admin",
      outcome: "exported",
      counts: { persons: 1, records: 17, attachments: 2 },
    })
    expect(of("household_export")[0][1]).toEqual({
      event: "household_export",
      protected: false,
      actor_role: "admin",
      outcome: "exported",
      counts: { persons: 3, records: 40, attachments: 2 },
    })
    expect(of("restore_applied")[0][1]).toEqual({
      event: "restore_applied",
      protected: false,
      actor_role: "admin",
      outcome: "applied",
      counts: { persons: 1, records: 26, attachments: 2 },
    })
    expect(of("person_erased")[0][1]).toMatchObject({
      event: "person_erased",
      actor_role: "admin",
      outcome: "erased",
      counts: { persons: 1, records: 16, attachments: 2, doses: 2, observations: 4 },
    })

    info.mockRestore()
    error.mockRestore()
  })
})
