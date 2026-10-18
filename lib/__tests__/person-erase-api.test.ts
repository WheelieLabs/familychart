// SPDX-License-Identifier: AGPL-3.0-only

import bcrypt from "bcryptjs"
import Database from "better-sqlite3-multiple-ciphers"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyBaselineSchema } from "@/lib/db"
import { listUploadMeta, readUpload, writeUpload, __setUploadBlobAdapterForTests, createMemoryUploadBlobAdapter } from "@/lib/uploads/store"
import type { UploadBucket } from "@/lib/uploads/types"
import { logger } from "@/lib/logger"
import { seedExportHousehold } from "./helpers/export-fixture"

const downloads: Response[] = []

vi.mock("@/lib/db", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}))

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => session),
}))

let testDb: Database.Database
let uploads: ReturnType<typeof createMemoryUploadBlobAdapter>
let session: {
  user: { id: string; email: string }
  sessionVersion: number
  entraAuthTime?: number
} | null

function signInAs(accountId: number, email: string) {
  session = { user: { id: `local:${accountId}`, email }, sessionVersion: 0 }
}

async function exportPerson(personId: number) {
  const { GET } = await import("@/app/api/people/[id]/export/route")
  const res = await GET(new NextRequest(`http://localhost/api/people/${personId}/export`), {
    params: Promise.resolve({ id: String(personId) }),
  })
  downloads.push(res)
  return res
}

async function erasePerson(personId: number, body?: Record<string, unknown>) {
  const { POST } = await import("@/app/api/people/[id]/erase/route")
  return POST(new NextRequest(`http://localhost/api/people/${personId}/erase`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }), {
    params: Promise.resolve({ id: String(personId) }),
  })
}

/** Every stored value, so a leftover name or note fails the scan wherever it sits. */
function databaseText(db: Database.Database): string {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  ).all() as { name: string }[]
  return tables.map(({ name }) => {
    const rows = db.prepare(`SELECT * FROM "${name.replace(/"/g, "")}"`).all()
    return JSON.stringify(rows)
  }).join("\n")
}

async function uploadsText(): Promise<string> {
  const buckets: UploadBucket[] = ["people", "test-results"]
  const parts: string[] = []
  for (const bucket of buckets) {
    for (const meta of await listUploadMeta(bucket)) {
      const body = await readUpload(bucket, meta.filename)
      parts.push(`${bucket}/${meta.filename}\n${body?.toString("utf8") ?? ""}`)
    }
  }
  return parts.join("\n")
}

const ALEX = [
  "Alex",
  "2015-04-02",
  "After breakfast",
  "Shoes off",
  "Iron studies",
  "Fasting",
  "Dr Smith",
  "Headache",
  "After school",
  "alex-jpeg-bytes",
  "iron-pdf-bytes",
  "ALEX_MARKER",
]

describe("POST /api/people/[id]/erase", () => {
  beforeEach(async () => {
    testDb = new Database(":memory:")
    testDb.pragma("foreign_keys = ON")
    applyBaselineSchema(testDb)
    uploads = createMemoryUploadBlobAdapter()
    __setUploadBlobAdapterForTests(uploads)
    await seedExportHousehold(testDb)
    signInAs(1, "admin@example.com")
  })

  afterEach(async () => {
    delete process.env.DEMO_MODE
    delete process.env.FC_PLATFORM_PROFILE
    for (const res of downloads.splice(0)) {
      if (res.body && !res.body.locked) await res.body.cancel()
    }
    testDb.close()
    __setUploadBlobAdapterForTests(null)
    vi.clearAllMocks()
  })

  it("leaves no table, file or audit detail holding the Person's name, date of birth or records", async () => {
    testDb.exec(`
      UPDATE people SET is_active = 0 WHERE id = 1;
      INSERT INTO audit_log (user_email, action, entity_type, entity_id, details) VALUES
        ('admin@example.com', 'CREATE', 'people', 1, '{"name":"Alex","date_of_birth":"2015-04-02"}'),
        ('admin@example.com', 'CREATE', 'medication_records', 30, '{"comments":"After breakfast"}'),
        ('admin@example.com', 'CREATE', 'people', 2, '{"name":"Sam"}');
      INSERT INTO favourites (user_uid, person_id, action_kind, label) VALUES
        ('local:1', 1, 'dose', 'ALEX_MARKER'),
        ('local:2', 2, 'dose', 'SAM_STAYS');
      INSERT INTO person_notification_prefs (person_id, user_uid) VALUES (1, 'local:1'), (2, 'local:2');
      INSERT INTO notification_log (recipient_user_id, person_id, type, title, body) VALUES
        ('local:1', 1, 'reminder', 'ALEX_MARKER', 'After breakfast'),
        ('local:2', 2, 'reminder', 'SAM_STAYS', 'Evening');
      INSERT INTO prn_push_requests (medication_record_id) VALUES (30);
      INSERT INTO push_log (ref_key) VALUES
        ('prn:30'),
        ('scheduled:20:2026-02-01:08:00'),
        ('overdue:20:2026-02-04:08:00'),
        ('dose-expectation:40:2026-02-01'),
        ('observation:1:2026-02-01'),
        ('hydration:1:2026-02-01:9'),
        ('prn:32'),
        ('hydration:2:2026-02-01:9');
    `)

    const res = await erasePerson(1)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.file_failures).toEqual([])
    expect(body.counts).toMatchObject({ doses: 2, observations: 4, files: 2 })
    expect(body.erase_again).toBe("If you ever restore a backup taken before this date, erase this person again.")
    expect(body.erased_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    const stored = `${databaseText(testDb)}\n${await uploadsText()}`
    for (const needle of ALEX) expect(stored).not.toContain(needle)

    expect(testDb.prepare("SELECT name, date_of_birth FROM people WHERE id = 2").get()).toEqual({
      name: "Sam", date_of_birth: "2001-09-30",
    })
    expect(testDb.prepare("SELECT id FROM medication_records WHERE id = 32").get()).toEqual({ id: 32 })
    expect(testDb.prepare("SELECT name FROM medications WHERE id = 10").get()).toEqual({ name: "Paracetamol" })
    expect(testDb.prepare("SELECT label FROM favourites WHERE person_id = 2").pluck().get()).toBe("SAM_STAYS")
    expect(testDb.prepare("SELECT ref_key FROM push_log ORDER BY ref_key").pluck().all()).toEqual([
      "hydration:2:2026-02-01:9",
      "prn:32",
    ])

    const audit = testDb.prepare(
      "SELECT user_email, action, entity_type, entity_id, details, created_at FROM audit_log ORDER BY id",
    ).all() as { user_email: string; action: string; entity_type: string; entity_id: number | null; details: string | null; created_at: string }[]
    const blanked = audit.filter(row => row.action === "CREATE" && row.entity_id !== 2)
    expect(blanked.map(row => row.details)).toEqual([null, null])
    expect(blanked.every(row => row.user_email === "admin@example.com" && row.entity_type != null && row.created_at != null)).toBe(true)
    expect(audit.find(row => row.entity_id === 2)?.details).toBe('{"name":"Sam"}')

    const erased = audit.filter(row => row.action === "ERASE")
    expect(erased).toHaveLength(1)
    expect(erased[0]).toMatchObject({ user_email: "admin@example.com", entity_type: "people", entity_id: null })
    expect(erased[0].details).not.toContain("Alex")
    expect(erased[0].details).not.toContain("2015-04-02")
    expect(JSON.parse(erased[0].details ?? "")).toMatchObject({
      event: "Person erased",
      counts: { doses: 2, observations: 4, files: 2 },
    })
  })

  it("refuses to erase a Person while their export is still downloading, then allows it once the download finishes", async () => {
    testDb.exec("UPDATE people SET is_active = 0 WHERE id = 1")
    const download = await exportPerson(1)
    expect(download.status).toBe(200)

    const refused = await erasePerson(1)
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: "An export of this person is still downloading" })
    expect(testDb.prepare("SELECT name FROM people WHERE id = 1").get()).toEqual({ name: "Alex" })

    await download.arrayBuffer()
    expect((await erasePerson(1)).status).toBe(200)
    expect(testDb.prepare("SELECT id FROM people WHERE id = 1").get()).toBeUndefined()
  })

  it("signs out a None-role Account only after the files are deleted and the result is built", async () => {
    testDb.exec("UPDATE people SET is_active = 0, photo_url = '/api/uploads/people/sam-photo.jpg' WHERE id = 2")
    const blobs = createMemoryUploadBlobAdapter()
    let accountDuringDelete: { is_active: number; session_version: number } | undefined
    __setUploadBlobAdapterForTests({
      ...blobs,
      delete: async (bucket, filename) => {
        accountDuringDelete = testDb.prepare(
          "SELECT is_active, session_version FROM accounts WHERE id = 2",
        ).get() as { is_active: number; session_version: number }
        return blobs.delete(bucket, filename)
      },
    })
    await writeUpload("people", "sam-photo.jpg", Buffer.from("sam-bytes"))

    const res = await erasePerson(2)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.account_outcome).toBe("deactivated")
    expect(body.account_note).toBeNull()
    expect(accountDuringDelete).toEqual({ is_active: 1, session_version: 0 })
    expect(testDb.prepare("SELECT is_active, session_version FROM accounts WHERE id = 2").get()).toEqual({
      is_active: 0, session_version: 1,
    })

    signInAs(2, "sam@example.com")
    expect((await erasePerson(3)).status).toBe(401)
    signInAs(1, "admin@example.com")
    expect((await erasePerson(3)).status).toBe(200)
  })

  it("leaves an Account with a Household Role signed in, and says so", async () => {
    testDb.exec("UPDATE people SET is_active = 0, account_uid = 'local:4' WHERE id = 1")
    const res = await erasePerson(1)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.account_outcome).toBe("kept")
    expect(body.account_note).toBe("This account has a household role, so it was left able to sign in.")
    expect(testDb.prepare("SELECT is_active, session_version, role FROM accounts WHERE id = 4").get()).toEqual({
      is_active: 1, session_version: 0, role: "write",
    })
  })

  it("still returns the erase result when signing out the None-role Account fails", async () => {
    testDb.exec(`
      UPDATE people SET is_active = 0 WHERE id = 2;
      CREATE TRIGGER fail_sign_out BEFORE UPDATE ON accounts
      BEGIN
        SELECT RAISE(ABORT, 'sign-out refused');
      END;
    `)
    const res = await erasePerson(2)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.erase_again).toBe("If you ever restore a backup taken before this date, erase this person again.")
    expect(body.account_outcome).toBe("deactivated")
    expect(testDb.prepare("SELECT id FROM people WHERE id = 2").get()).toBeUndefined()
    expect(testDb.prepare("SELECT is_active, session_version FROM accounts WHERE id = 2").get()).toEqual({
      is_active: 1, session_version: 0,
    })
  })

  it("rolls the database back when the delete is rejected, and leaves the files in place", async () => {
    testDb.exec(`
      UPDATE people SET is_active = 0 WHERE id = 1;
      INSERT INTO audit_log (user_email, action, entity_type, entity_id, details)
        VALUES ('admin@example.com', 'CREATE', 'people', 1, '{"name":"Alex"}');
      CREATE TRIGGER fail_person_delete BEFORE DELETE ON people
      BEGIN
        SELECT RAISE(ABORT, 'injected');
      END;
    `)
    const res = await erasePerson(1)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "Erase failed" })
    expect(testDb.prepare("SELECT name FROM people WHERE id = 1").get()).toEqual({ name: "Alex" })
    expect(testDb.prepare("SELECT comments FROM medication_records WHERE id = 30").get()).toEqual({
      comments: "After breakfast",
    })
    expect(testDb.prepare("SELECT details FROM audit_log WHERE entity_type = 'people' AND entity_id = 1").get()).toEqual({
      details: '{"name":"Alex"}',
    })
    expect(testDb.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ERASE'").get()).toEqual({ n: 0 })
    expect((await readUpload("people", "alex-photo.jpg"))?.toString("utf8")).toBe("alex-jpeg-bytes")
  })

  it("reports a file that could not be deleted without putting the records back", async () => {
    testDb.exec("UPDATE people SET is_active = 0 WHERE id = 1")
    __setUploadBlobAdapterForTests({
      ...uploads,
      delete: async (bucket, filename) => {
        if (filename === "88888888-8888-4888-8888-888888888888.pdf") throw new Error("disk full")
        return uploads.delete(bucket, filename)
      },
    })
    const res = await erasePerson(1)
    expect(res.status).toBe(200)
    expect((await res.json()).file_failures).toEqual([
      { path: "test-results/88888888-8888-4888-8888-888888888888.pdf", reason: "The file could not be deleted" },
    ])
    expect(testDb.prepare("SELECT id FROM people WHERE id = 1").get()).toBeUndefined()
    expect(testDb.prepare("SELECT name FROM people WHERE id = 2").get()).toEqual({ name: "Sam" })
    expect((await readUpload("test-results", "88888888-8888-4888-8888-888888888888.pdf"))?.toString("utf8")).toBe("iron-pdf-bytes")
    expect(await readUpload("people", "alex-photo.jpg")).toBeNull()
  })

  it("lets a linked adult erase only their own Person, after confirming their password", async () => {
    const password = "sam-secret"
    testDb.prepare("UPDATE accounts SET password_hash = ? WHERE id = 2").run(bcrypt.hashSync(password, 4))
    signInAs(2, "sam@example.com")

    const other = await erasePerson(1, { password })
    expect(other.status).toBe(404)
    expect(testDb.prepare("SELECT name FROM people WHERE id = 1").get()).toEqual({ name: "Alex" })

    const unconfirmed = await erasePerson(2, {})
    expect(unconfirmed.status).toBe(401)
    expect(testDb.prepare("SELECT id FROM people WHERE id = 2").get()).toEqual({ id: 2 })

    const own = await erasePerson(2, { password })
    expect(own.status).toBe(200)
    expect(testDb.prepare("SELECT id FROM people WHERE id = 2").get()).toBeUndefined()
    expect(testDb.prepare("SELECT is_active FROM accounts WHERE id = 2").get()).toEqual({ is_active: 0 })
  })

  it("refuses a linked adult who confirms the wrong password", async () => {
    testDb.prepare("UPDATE accounts SET password_hash = ? WHERE id = 2").run(bcrypt.hashSync("sam-secret", 4))
    signInAs(2, "sam@example.com")
    const res = await erasePerson(2, { password: "not-the-password" })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "Current password is incorrect" })
    expect(testDb.prepare("SELECT id FROM people WHERE id = 2").get()).toEqual({ id: 2 })
  })

  it("refuses a Manager, an unlinked Account, an anonymous request, and the demo", async () => {
    signInAs(3, "manager@example.com")
    expect((await erasePerson(1)).status).toBe(404)

    signInAs(5, "unlinked@example.com")
    expect((await erasePerson(2)).status).toBe(404)
    expect(testDb.prepare("SELECT id FROM people WHERE id = 2").get()).toEqual({ id: 2 })

    session = null
    expect((await erasePerson(1)).status).toBe(401)

    signInAs(1, "admin@example.com")
    testDb.exec("UPDATE people SET is_active = 0 WHERE id = 1")
    process.env.DEMO_MODE = "true"
    process.env.FC_PLATFORM_PROFILE = "demo"
    const demo = await erasePerson(1)
    expect(demo.status).toBe(403)
    expect(await demo.json()).toEqual({ error: "Erasing a person is disabled in demo mode" })
    expect(testDb.prepare("SELECT name FROM people WHERE id = 1").get()).toEqual({ name: "Alex" })
  })

  it("lets a linked adult erase their own Person after a fresh Entra sign-in, and refuses a stale one", async () => {
    testDb.exec("UPDATE people SET account_uid = 'oid-sam' WHERE id = 2")
    session = {
      user: { id: "oid-sam", email: "sam@example.com" },
      sessionVersion: 0,
      entraAuthTime: Date.now() - 6 * 60_000,
    }
    const stale = await erasePerson(2)
    expect(stale.status).toBe(401)
    expect(await stale.json()).toEqual({ error: "Sign in again to erase your records" })
    expect(testDb.prepare("SELECT id FROM people WHERE id = 2").get()).toEqual({ id: 2 })

    session = { ...session, entraAuthTime: Date.now() }
    expect((await erasePerson(2)).status).toBe(200)
    expect(testDb.prepare("SELECT id FROM people WHERE id = 2").get()).toBeUndefined()
  })

  it("logs the erase with the actor's role and counts, and no personal data", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => {})
    testDb.exec("UPDATE people SET is_active = 0 WHERE id = 1")
    await erasePerson(1)
    const logged = JSON.stringify(info.mock.calls)
    for (const needle of ALEX) expect(logged).not.toContain(needle)
    expect(info).toHaveBeenCalledWith("person_erased", expect.objectContaining({
      actor_role: "admin",
      outcome: "erased",
      counts: expect.objectContaining({ doses: 2, observations: 4 }),
    }))
    info.mockRestore()
  })

  it("requires an Admin to deactivate a Person before erasing them", async () => {
    const res = await erasePerson(1)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "Deactivate this person before erasing them" })
    expect(testDb.prepare("SELECT name FROM people WHERE id = 1").get()).toEqual({ name: "Alex" })
  })

  it("removes a linked Account when asked, and leaves the last local Admin in place", async () => {
    testDb.exec("UPDATE people SET is_active = 0, account_uid = 'local:4' WHERE id = 1")
    const removed = await erasePerson(1, { remove_account: true })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toMatchObject({ account_outcome: "removed" })
    expect(testDb.prepare("SELECT id FROM people WHERE id = 1").get()).toBeUndefined()
    expect(testDb.prepare("SELECT id FROM accounts WHERE id = 4").get()).toBeUndefined()

    testDb.exec("UPDATE people SET is_active = 0, account_uid = 'local:1' WHERE id = 3")
    const blocked = await erasePerson(3, { remove_account: true })
    expect(blocked.status).toBe(200)
    const body = await blocked.json()
    expect(body.account_outcome).toBe("kept")
    expect(testDb.prepare("SELECT id, is_active, role FROM accounts WHERE id = 1").get()).toEqual({
      id: 1, is_active: 1, role: "admin",
    })
  })

  it("answers 500 and logs the database cause when the erase throws", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => {})
    testDb.exec("DROP TABLE notification_log")
    const res = await erasePerson(3)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "Erase failed" })
    expect(error).toHaveBeenCalledWith("person_erase_failed", expect.objectContaining({
      err: expect.stringContaining("notification_log"),
    }))
    error.mockRestore()
  })

  it("erases a Person with a long history of doses", async () => {
    // One push-dedupe pattern per dose once overflowed SQLite's expression depth limit of 1000.
    const med = (testDb.prepare("SELECT id FROM medications LIMIT 1").get() as { id: number }).id
    const insDose = testDb.prepare("INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES (3, ?, datetime('now'))")
    const insPush = testDb.prepare("INSERT INTO push_log (ref_key) VALUES (?)")
    for (let i = 0; i < 1500; i++) {
      const id = Number(insDose.run(med).lastInsertRowid)
      if (i % 2 === 0) insPush.run(`prn:${id}`)
    }
    insPush.run("prn:999999")
    testDb.exec("UPDATE people SET is_active = 0 WHERE id = 3")
    const res = await erasePerson(3)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.counts.doses).toBe(1500)
    expect(body.counts.push_dedupe).toBe(750)
    expect(testDb.prepare("SELECT COUNT(*) AS n FROM medication_records WHERE person_id = 3").get()).toEqual({ n: 0 })
    expect(testDb.prepare("SELECT COUNT(*) AS n FROM push_log").get()).toEqual({ n: 1 })
  })

  it("deletes a Person's slot outcomes explicitly, counts them, and leaves other Persons' outcomes", async () => {
    testDb.exec("UPDATE people SET is_active = 0 WHERE id = 1")
    expect(testDb.prepare("SELECT COUNT(*) AS n FROM slot_outcomes").get()).toEqual({ n: 3 })
    const res = await erasePerson(1)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.counts.slot_outcomes).toBe(2)
    expect(testDb.prepare("SELECT person_medication_id FROM slot_outcomes").all()).toEqual([{ person_medication_id: 22 }])
  })

  it("erases 40,000 doses with slot outcomes beside a 200,000-row audit log quickly, on indexed lookups", async () => {
    const med = (testDb.prepare("SELECT id FROM medications LIMIT 1").get() as { id: number }).id
    testDb.exec(`
      INSERT INTO person_medications (id, person_id, medication_id, schedule_times, schedule_frequency)
      VALUES (90, 3, ${med}, '["08:00"]', 'daily');
    `)
    const insDose = testDb.prepare("INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES (3, ?, datetime('now'))")
    const insOutcome = testDb.prepare(
      `INSERT INTO slot_outcomes (person_medication_id, local_ymd, slot_hhmm, result, offset_minutes, medication_record_id)
       VALUES (90, ?, ?, 'on_time', 0, ?)`,
    )
    const insAudit = testDb.prepare("INSERT INTO audit_log (user_email, action, entity_type, entity_id) VALUES ('x@y.z', 'CREATE', 'medication_records', ?)")
    testDb.transaction(() => {
      for (let i = 0; i < 40000; i++) {
        const id = Number(insDose.run(med).lastInsertRowid)
        const day = new Date(Date.UTC(2000, 0, 1) + Math.floor(i / 20) * 86_400_000).toISOString().slice(0, 10)
        insOutcome.run(day, `${String(i % 20).padStart(2, "0")}:00`, id)
      }
      for (let i = 0; i < 200000; i++) insAudit.run(i)
    })()
    testDb.exec("UPDATE people SET is_active = 0 WHERE id = 3")
    for (const sql of [
      "SELECT COUNT(*) FROM slot_outcomes WHERE person_medication_id IN (SELECT id FROM person_medications WHERE person_id = 3)",
      "DELETE FROM slot_outcomes WHERE person_medication_id IN (SELECT id FROM person_medications WHERE person_id = 3)",
    ]) {
      const plan = (testDb.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map(row => row.detail).join(" ")
      expect(plan).toMatch(/USING (COVERING )?INDEX/)
      expect(plan).not.toMatch(/SCAN slot_outcomes/)
    }
    const started = Date.now()
    const res = await erasePerson(3)
    expect(res.status).toBe(200)
    expect((await res.json()).counts).toMatchObject({ doses: 40000, slot_outcomes: 40000 })
    expect(Date.now() - started).toBeLessThan(15000)
    expect(testDb.prepare("SELECT COUNT(*) AS n FROM slot_outcomes WHERE person_medication_id = 90").get()).toEqual({ n: 0 })
  }, 60000)

  it("erases a large history in a reasonable time and keeps audit lookups indexed", async () => {
    const med = (testDb.prepare("SELECT id FROM medications LIMIT 1").get() as { id: number }).id
    const insDose = testDb.prepare("INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES (3, ?, datetime('now'))")
    const insAudit = testDb.prepare("INSERT INTO audit_log (user_email, action, entity_type, entity_id) VALUES ('x@y.z', 'CREATE', 'medication_records', ?)")
    testDb.transaction(() => {
      for (let i = 0; i < 5000; i++) insDose.run(med)
      for (let i = 0; i < 25000; i++) insAudit.run(i)
    })()
    testDb.exec("UPDATE people SET is_active = 0 WHERE id = 3")
    const plan = testDb.prepare(
      "EXPLAIN QUERY PLAN UPDATE audit_log SET details = NULL WHERE entity_type = ? AND entity_id = ?",
    ).all("people", 3) as { detail: string }[]
    expect(plan.map(row => row.detail).join(" ")).toContain("idx_audit_log_entity")
    const started = Date.now()
    const res = await erasePerson(3)
    expect(res.status).toBe(200)
    expect(Date.now() - started).toBeLessThan(5000)
  })

  describe("an Admin erasing the Person linked to their own Account with remove_account", () => {
    beforeEach(() => {
      testDb.exec(`
        INSERT INTO accounts (id, email, role) VALUES (6, 'admin2@example.com', 'admin');
        UPDATE people SET is_active = 0, account_uid = 'local:1' WHERE id = 3;
      `)
      testDb.prepare("UPDATE accounts SET password_hash = ? WHERE id = 1").run(bcrypt.hashSync("admin-secret", 4))
    })

    it("refuses without re-proof and deletes nothing", async () => {
      const res = await erasePerson(3, { remove_account: true })
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: "Confirm your password to erase your records" })
      expect(testDb.prepare("SELECT id FROM people WHERE id = 3").get()).toEqual({ id: 3 })
      expect(testDb.prepare("SELECT id FROM accounts WHERE id = 1").get()).toEqual({ id: 1 })
    })

    it("erases an Admin's own active Person in one step after re-proof, without deactivating it first", async () => {
      testDb.prepare("UPDATE people SET is_active = 1 WHERE id = 3").run()
      const refused = await erasePerson(3, {})
      expect(refused.status).toBe(401)
      expect(testDb.prepare("SELECT id FROM people WHERE id = 3").get()).toEqual({ id: 3 })
      const res = await erasePerson(3, { password: "admin-secret" })
      expect(res.status).toBe(200)
      expect(testDb.prepare("SELECT id FROM people WHERE id = 3").get()).toBeUndefined()
    })

    it("refuses a wrong password", async () => {
      const res = await erasePerson(3, { remove_account: true, password: "nope" })
      expect(res.status).toBe(401)
      expect(testDb.prepare("SELECT id FROM accounts WHERE id = 1").get()).toEqual({ id: 1 })
    })

    it("erases the Person and removes the Account with valid re-proof", async () => {
      const res = await erasePerson(3, { remove_account: true, password: "admin-secret" })
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ account_outcome: "removed" })
      expect(testDb.prepare("SELECT id FROM people WHERE id = 3").get()).toBeUndefined()
      expect(testDb.prepare("SELECT id FROM accounts WHERE id = 1").get()).toBeUndefined()
    })

    it("needs a fresh Entra sign-in for an Entra Admin", async () => {
      testDb.exec(`
        INSERT INTO accounts (id, email, role, auth_method, external_id) VALUES (7, 'entra@example.com', 'none', 'entra', 'oid-admin');
        UPDATE people SET account_uid = 'oid-admin' WHERE id = 3;
      `)
      session = {
        user: { id: "oid-admin", email: "entra@example.com", groups: ["local:admin"] },
        sessionVersion: 0,
        entraAuthTime: Date.now() - 6 * 60_000,
      } as typeof session
      const stale = await erasePerson(3, { remove_account: true })
      expect(stale.status).toBe(401)
      expect(testDb.prepare("SELECT id FROM people WHERE id = 3").get()).toEqual({ id: 3 })

      session = { ...session!, entraAuthTime: Date.now() }
      const fresh = await erasePerson(3, { remove_account: true })
      expect(fresh.status).toBe(200)
      expect(testDb.prepare("SELECT id FROM accounts WHERE id = 7").get()).toBeUndefined()
    })

    it("asks for no re-proof when the Account is not removed too", async () => {
      expect((await erasePerson(3)).status).toBe(200)
    })

    it("asks for no re-proof when the linked Account is someone else's", async () => {
      testDb.exec("UPDATE people SET account_uid = 'local:6' WHERE id = 3")
      const res = await erasePerson(3, { remove_account: true })
      expect(res.status).toBe(200)
      expect(testDb.prepare("SELECT id FROM accounts WHERE id = 6").get()).toBeUndefined()
    })

    it("tells the confirmation screen that re-proof applies", async () => {
      const { GET } = await import("@/app/api/people/[id]/erase/route")
      const res = await GET(new NextRequest("http://localhost/api/people/3/erase"), {
        params: Promise.resolve({ id: "3" }),
      })
      expect((await res.json()).account).toMatchObject({ is_own: true, is_local: true, mfa_enrolled: false })
      testDb.exec("UPDATE people SET account_uid = 'local:6' WHERE id = 3")
      const other = await GET(new NextRequest("http://localhost/api/people/3/erase"), {
        params: Promise.resolve({ id: "3" }),
      })
      expect((await other.json()).account).toMatchObject({ is_own: false })
    })
  })

  it("allows erase once an export download is abandoned", async () => {
    testDb.exec("UPDATE people SET is_active = 0 WHERE id = 1")
    const download = await exportPerson(1)
    await download.body!.cancel()
    expect((await erasePerson(1)).status).toBe(200)
  })
})
