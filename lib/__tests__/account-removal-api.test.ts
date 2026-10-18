// SPDX-License-Identifier: AGPL-3.0-only

import { ZipArchive } from "archiver"
import { mkdtempSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { Writable } from "stream"
import Database from "better-sqlite3-multiple-ciphers"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyBaselineSchema } from "@/lib/db"
import { refreshLocalUserSession } from "@/lib/local-user-session"
import { REMOVED_ACCOUNT_LABEL, REMOVED_ACCOUNT_PREFIX } from "@/lib/account/removed-account-label"
import { entraOidHash } from "@/lib/account/entra-removed"

vi.mock("@/lib/db", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}))

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => session),
}))

let testDb: Database.Database
let session: {
  user: { id: string; email: string; groups?: string[]; entraOid?: string }
  sessionVersion: number
  entraAuthTime?: number
} | null

const REMOVED = "carer@example.com"
const KEEPER = "keeper@example.com"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  applyBaselineSchema(db)
  db.pragma("foreign_keys = ON")
  db.exec(`
    INSERT INTO accounts (
      id, email, password_hash, role, is_active, can_report, totp_secret, totp_secret_pending,
      session_version, must_reset_password, auth_method, status, invite_token_hash, invite_expires_at
    ) VALUES
      (1, 'admin@example.com', 'admin-hash', 'admin', 1, 0, NULL, NULL, 0, 0, 'local', 'active', NULL, NULL),
      (2, '${REMOVED}', 'secret-hash', 'write', 1, 1, 'totp-live', 'totp-pending', 4, 1, 'local', 'active', 'invite-hash', '2099-01-01');
    INSERT INTO people (id, name, account_uid) VALUES (7, 'Kept Person', NULL);
    INSERT INTO medications (id, name) VALUES (3, 'Paracetamol');
    INSERT INTO person_medications (id, person_id, medication_id) VALUES (9, 7, 3);
    INSERT INTO medication_records (id, person_id, medication_id, recorded_at, created_by) VALUES
      (11, 7, 3, '2026-01-01T00:00:00Z', '${REMOVED}'),
      (12, 7, 3, '2026-01-02T00:00:00Z', '${KEEPER}');
    INSERT INTO observations (id, person_id, observation_type, value, unit, recorded_at, created_by) VALUES
      (21, 7, 'Weight', 70, 'kg', '2026-01-01T00:00:00Z', '${REMOVED}');
    INSERT INTO test_events (id, person_id, test_type, name, date, created_by) VALUES
      (31, 7, '', 'Bloods', '2026-01-01', '${REMOVED}');
    INSERT INTO symptom_events (id, person_id, label, start_date, severity, created_by) VALUES
      (41, 7, 'Headache', '2026-01-01', 1, '${REMOVED}');
    INSERT INTO symptom_dose_links (symptom_event_id, medication_record_id, person_id, created_by) VALUES
      (41, 11, 7, '${REMOVED}');
    INSERT INTO dose_expectations (id, person_medication_id, slot_hhmm, start_date, end_date, created_by) VALUES
      (51, 9, '08:00', '2026-01-01', '2026-12-31', '${REMOVED}');
    INSERT INTO push_endpoints (user_uid, endpoint, p256dh, web_push_auth) VALUES
      ('local:2', 'https://push.example/carer', 'p256', 'auth');
    INSERT INTO favourites (user_uid, person_id, action_kind, label) VALUES
      ('local:2', 7, 'observation', 'Weight');
    INSERT INTO user_settings (user_uid, key, value, updated_at) VALUES
      ('local:2', 'locale.measurement_system', 'metric', 1);
    INSERT INTO user_app_state (user_uid, last_seen_version) VALUES ('local:2', '1.0.0');
    INSERT INTO notification_log (recipient_user_id, person_id, type, title, body) VALUES
      ('local:2', 7, 'prn', 'Reminder', 'Dose');
    INSERT INTO audit_log (user_email, action, entity_type, entity_id, details) VALUES
      ('${REMOVED}', 'CREATE', 'medication_records', 11, '{"note":"left alone","email":"${REMOVED}"}'),
      ('${KEEPER}', 'CREATE', 'medication_records', 12, '{"note":"keeper"}');
  `)
  return db
}

async function removeAccount(id: number, email: string) {
  const { POST } = await import("@/app/api/accounts/[id]/remove/route")
  return POST(new NextRequest(`http://localhost/api/accounts/${id}/remove`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  }), { params: Promise.resolve({ id: String(id) }) })
}

describe("POST /api/accounts/[id]/remove", () => {
  beforeEach(() => {
    testDb = createTestDb()
    session = {
      user: { id: "local:1", email: "admin@example.com", groups: ["local:admin"] },
      sessionVersion: 0,
    }
  })

  afterEach(() => {
    testDb.close()
  })

  it("removes another account, its credentials and its dependent rows, and signs that user out", async () => {
    const res = await removeAccount(2, REMOVED)
    expect(res.status).toBe(200)

    expect(testDb.prepare("SELECT id FROM accounts WHERE id = 2").get()).toBeUndefined()
    expect(testDb.prepare("SELECT email, password_hash, totp_secret FROM accounts WHERE id = 1").get()).toEqual({
      email: "admin@example.com",
      password_hash: "admin-hash",
      totp_secret: null,
    })
    expect(testDb.prepare("SELECT id, name, account_uid FROM people").all()).toEqual([
      { id: 7, name: "Kept Person", account_uid: null },
    ])
    expect(testDb.prepare("SELECT COUNT(*) AS n FROM push_endpoints").get()).toEqual({ n: 0 })
    expect(testDb.prepare("SELECT COUNT(*) AS n FROM favourites").get()).toEqual({ n: 0 })
    expect(testDb.prepare("SELECT COUNT(*) AS n FROM user_settings").get()).toEqual({ n: 0 })
    expect(testDb.prepare("SELECT COUNT(*) AS n FROM user_app_state").get()).toEqual({ n: 0 })
    expect(testDb.prepare("SELECT COUNT(*) AS n FROM notification_log").get()).toEqual({ n: 0 })
    expect(refreshLocalUserSession(testDb, 2, 4)).toBeNull()

    const removed = testDb.prepare(
      "SELECT action, user_email, details FROM audit_log WHERE action = 'DELETE' AND entity_type = 'accounts'",
    ).get() as { action: string; user_email: string; details: string }
    const details = JSON.parse(removed.details) as { event: string; counts: { audit_rows: number; record_rows: number } }
    expect(removed.user_email).toBe("admin@example.com")
    expect(details.event).toBe("Account removed")
    expect(details.counts.audit_rows).toBe(1)
    expect(details.counts.record_rows).toBe(6)
    expect(removed.details).not.toContain(REMOVED)
  })

  it("rewrites that email to one token in the audit log and every created_by column, with nothing mapping it back", async () => {
    const res = await removeAccount(2, REMOVED)
    expect(res.status).toBe(200)

    const tables = (testDb.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    ).all() as { name: string }[]).map(row => row.name)
    const createdByTables = tables.filter(name => {
      const columns = testDb.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]
      return columns.some(column => column.name === "created_by")
    })
    expect(createdByTables.sort()).toEqual([
      "dose_expectations",
      "medication_records",
      "observations",
      "symptom_dose_links",
      "symptom_events",
      "test_events",
    ])

    const tokens = new Set<string>()
    for (const table of createdByTables) {
      const rows = testDb.prepare(`SELECT created_by FROM ${table}`).all() as { created_by: string }[]
      for (const row of rows) {
        if (row.created_by === KEEPER) continue
        tokens.add(row.created_by)
      }
    }
    const auditActors = testDb.prepare(
      "SELECT user_email FROM audit_log WHERE user_email NOT IN ('admin@example.com', ?)",
    ).all(KEEPER) as { user_email: string }[]
    for (const row of auditActors) tokens.add(row.user_email)

    expect(tokens.size).toBe(1)
    const token = [...tokens][0]
    expect(token.startsWith(REMOVED_ACCOUNT_PREFIX)).toBe(true)
    expect(token).not.toContain("@")
    expect(testDb.prepare("SELECT created_by FROM medication_records WHERE id = 12").get()).toEqual({
      created_by: KEEPER,
    })
    const keptDetails = testDb.prepare(
      "SELECT details FROM audit_log WHERE entity_id = 11",
    ).get() as { details: string }
    expect(keptDetails.details).toContain(REMOVED)

    const actors = tables.flatMap(name => {
      const columns = testDb.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]
      return columns
        .filter(column => column.name === "user_email" || column.name === "created_by")
        .map(column => testDb.prepare(`SELECT ${column.name} AS value FROM ${name}`).all() as { value: string | null }[])
    }).flat()
    expect(actors.some(row => row.value === REMOVED)).toBe(false)
    const lookup = tables.find(name => /pseudonym|tombstone_email|removed_email/i.test(name))
    expect(lookup).toBeUndefined()

    const { displayAccountActor } = await import("@/lib/account/removed-account-label")
    expect(displayAccountActor(token)).toBe(REMOVED_ACCOUNT_LABEL)
    expect(displayAccountActor(token)).not.toContain(token.slice(REMOVED_ACCOUNT_PREFIX.length))
  })

  it("refuses to remove the last local Admin and still refuses demotion through the edit route", async () => {
    session = {
      user: { id: "entra-admin", email: "entra-admin@example.com", groups: ["local:admin"] },
      sessionVersion: 0,
    }
    const res = await removeAccount(1, "admin@example.com")
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Cannot remove the last local Admin" })
    expect(testDb.prepare("SELECT role FROM accounts WHERE id = 1").get()).toEqual({ role: "admin" })

    session = {
      user: { id: "local:1", email: "admin@example.com", groups: ["local:admin"] },
      sessionVersion: 0,
    }
    testDb.prepare("DELETE FROM accounts WHERE id = 2").run()
    const { PUT } = await import("@/app/api/accounts/[id]/route")
    const edit = await PUT(new NextRequest("http://localhost/api/accounts/1", {
      method: "PUT",
      body: JSON.stringify({ role: "read" }),
    }), { params: Promise.resolve({ id: "1" }) })
    expect(edit.status).toBe(400)
    expect(await edit.json()).toEqual({ error: "Cannot remove the last local Admin" })
  })

  it("does not count a pending Admin Invite as another Admin", async () => {
    session = {
      user: { id: "entra-admin", email: "entra-admin@example.com", groups: ["local:admin"] },
      sessionVersion: 0,
    }
    testDb.prepare("DELETE FROM accounts WHERE id = 2").run()
    testDb.prepare("INSERT INTO accounts (id, email, role, auth_method, status) VALUES (30, 'pending@example.com', 'admin', 'local', 'invited')").run()
    const res = await removeAccount(1, "admin@example.com")
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Cannot remove the last local Admin" })
    expect(testDb.prepare("SELECT id FROM accounts WHERE id = 1").get()).toBeTruthy()
  })

  it("refuses removal while a Person is linked, in demo mode, and when an Admin targets their own account", async () => {
    testDb.prepare("UPDATE people SET account_uid = 'local:2' WHERE id = 7").run()
    const linked = await removeAccount(2, REMOVED)
    expect(linked.status).toBe(409)
    expect(await linked.json()).toEqual({
      error: "This account is still linked to a Person. Unlink it first, or erase the Person.",
    })
    expect(testDb.prepare("SELECT account_uid FROM people WHERE id = 7").get()).toEqual({ account_uid: "local:2" })

    testDb.prepare("UPDATE people SET account_uid = NULL WHERE id = 7").run()
    process.env.DEMO_MODE = "true"
    process.env.FC_PLATFORM_PROFILE = "demo"
    const demo = await removeAccount(2, REMOVED)
    expect(demo.status).toBe(403)
    expect(await demo.json()).toEqual({ error: "This is a demo environment — account changes are disabled." })
    delete process.env.DEMO_MODE
    delete process.env.FC_PLATFORM_PROFILE
    expect(testDb.prepare("SELECT id FROM accounts WHERE id = 2").get()).toEqual({ id: 2 })

    const own = await removeAccount(1, "admin@example.com")
    expect(own.status).toBe(400)
    expect(await own.json()).toEqual({
      error: "Remove your own account from Profile after signing in again.",
    })
    expect(testDb.prepare("SELECT id FROM accounts WHERE id = 1").get()).toEqual({ id: 1 })
  })

  it("requires a fresh re-authentication before an Account holder removes their own", async () => {
    testDb.prepare(
      "INSERT INTO accounts (id, email, password_hash, role, auth_method) VALUES (3, 'other-admin@example.com', 'h', 'admin', 'local')",
    ).run()
    session = { user: { id: "local:1", email: "admin@example.com" }, sessionVersion: 0 }
    const { POST } = await import("@/app/api/me/remove-account/route")
    const missing = await POST(new NextRequest("http://localhost/api/me/remove-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }))
    expect(missing.status).toBe(401)
    expect(testDb.prepare("SELECT id FROM accounts WHERE id = 1").get()).toEqual({ id: 1 })
  })
})

describe("POST /api/me/remove-account (Entra self-removal step-up)", () => {
  beforeEach(() => {
    testDb = createTestDb()
    testDb.prepare(`
      INSERT INTO accounts (id, email, role, auth_method, external_id, status)
      VALUES (8, 'entra@example.com', 'read', 'entra', 'oid-self', 'active')
    `).run()
  })

  afterEach(() => {
    testDb.close()
  })

  async function removeSelf() {
    const { POST } = await import("@/app/api/me/remove-account/route")
    return POST(new NextRequest("http://localhost/api/me/remove-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }))
  }

  function asEntra(entraAuthTime: number | undefined) {
    session = {
      user: { id: "oid-self", email: "entra@example.com", entraOid: "oid-self" },
      sessionVersion: 0,
      entraAuthTime,
    }
  }

  it.each([
    ["an auth_time older than the window", Date.now() - 6 * 60_000],
    ["no auth_time claim", undefined],
  ])("refuses with %s and keeps the account", async (_label, authTime) => {
    asEntra(authTime)
    const res = await removeSelf()
    expect(res.status).toBe(401)
    expect(testDb.prepare("SELECT id FROM accounts WHERE id = 8").get()).toEqual({ id: 8 })
  })

  it("removes the account on a fresh auth_time", async () => {
    asEntra(Date.now())
    const res = await removeSelf()
    expect(res.status).toBe(200)
    expect(testDb.prepare("SELECT id FROM accounts WHERE id = 8").get()).toBeUndefined()
  })
})

describe("Entra account removal", () => {
  beforeEach(() => {
    testDb = createTestDb()
    testDb.prepare(`
      INSERT INTO accounts (id, email, role, auth_method, external_id, status)
      VALUES (8, 'entra@example.com', 'read', 'entra', 'oid-removed', 'active')
    `).run()
    testDb.prepare(`
      INSERT INTO auth_revalidation_status (provider, external_id, status, email, display_name, updated_at)
      VALUES ('entra', 'oid-removed', 'ok', 'entra@example.com', 'Entra Person', 1)
    `).run()
    session = {
      user: { id: "local:1", email: "admin@example.com", groups: ["local:admin"] },
      sessionVersion: 0,
    }
  })

  afterEach(() => {
    testDb.close()
  })

  it("tombstones a hash of the object id and a later sign-in does not recreate the account", async () => {
    const res = await removeAccount(8, "entra@example.com")
    expect(res.status).toBe(200)
    expect(testDb.prepare("SELECT id FROM accounts WHERE id = 8").get()).toBeUndefined()
    expect(testDb.prepare("SELECT external_id FROM auth_revalidation_status").all()).toEqual([])

    const tomb = testDb.prepare("SELECT oid_hash, removed_at FROM entra_removed_accounts").all() as {
      oid_hash: string
      removed_at: string
    }[]
    expect(tomb).toEqual([{ oid_hash: entraOidHash("oid-removed"), removed_at: expect.any(String) }])
    const dumped = JSON.stringify(tomb)
    expect(dumped).not.toContain("entra@example.com")
    expect(dumped).not.toContain("oid-removed")
    expect(dumped).not.toContain("Entra Person")

    const { signInEntraAccount } = await import("@/lib/account/account-entra-match")
    const blocked = signInEntraAccount(testDb, { oid: "oid-removed", email: "entra@example.com" })
    expect(blocked).toEqual({ removed: true })
    expect(testDb.prepare("SELECT COUNT(*) AS n FROM accounts WHERE email = 'entra@example.com'").get()).toEqual({ n: 0 })

    const { POST } = await import("@/app/api/admin/entra-removed/route")
    const allow = await POST(new NextRequest("http://localhost/api/admin/entra-removed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entraOidHash("oid-removed") }),
    }))
    expect(allow.status).toBe(200)
    const again = signInEntraAccount(testDb, { oid: "oid-removed", email: "entra@example.com" })
    expect(again).toEqual({ accountId: expect.any(Number) })
    expect(testDb.prepare("SELECT email FROM accounts WHERE external_id = 'oid-removed'").get()).toEqual({
      email: "entra@example.com",
    })
  })

  it("skips a tombstoned Entra person on restore and re-invites a removed email only when asked", async () => {
    const removed = await removeAccount(2, REMOVED)
    expect(removed.status).toBe(200)
    const token = (testDb.prepare("SELECT created_by FROM medication_records WHERE id = 11").get() as { created_by: string }).created_by

    testDb.prepare("INSERT INTO entra_removed_accounts (oid_hash, removed_at) VALUES (?, ?)").run(
      entraOidHash("oid-gone"),
      "2026-10-12T00:00:00.000Z",
    )
    const now = Date.now()
    const settings = testDb.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)")
    for (const [key, value] of [
      ["email.smtp.host", "smtp.example.com"],
      ["email.smtp.port", "587"],
      ["email.smtp.tls", "true"],
      ["email.smtp.password", "secret"],
    ] as const) {
      settings.run(key, value, now)
    }

    const zipPath = await writeHouseholdZip({
      accounts: [
        {
          id: 1,
          db_id: 8,
          email: "gone@example.com",
          role: "read",
          can_report: 0,
          is_active: 1,
          auth_method: "entra",
          person_id: null,
          external_id: "oid-gone",
        },
        {
          id: 2,
          db_id: 2,
          email: REMOVED,
          role: "write",
          can_report: 1,
          is_active: 1,
          auth_method: "local",
          person_id: null,
        },
      ],
    })

    const { applyRestoreAccounts, planRestoreAccounts } = await import("@/lib/restore/restore-accounts")
    const plan = planRestoreAccounts(testDb, zipPath, new Map(), new Map(), null)
    expect(plan).not.toBe("not restored")
    if (plan === "not restored") return
    expect(plan.status).toBe("ready")
    if (plan.status !== "ready") return
    const entra = plan.items.find(item => item.email === "gone@example.com")
    const local = plan.items.find(item => item.email === REMOVED)
    expect(entra).toMatchObject({
      included: false,
      skip_reason: "entra_removed",
      note: "removed on this instance; allow them back first",
    })
    expect(local).toMatchObject({ included: true, skip_reason: null })

    const inviter = { id: "local:1", email: "admin@example.com", groups: ["local:admin"] }
    const held = applyRestoreAccounts(
      testDb, zipPath, new Map(), new Map(), new Map(),
      [{ bundle_id: 2, included: false }],
      inviter, "http://localhost", "admin@example.com",
    )
    expect(held.result.invites_created).toBe(0)
    expect(testDb.prepare("SELECT id FROM accounts WHERE email = ?").get(REMOVED)).toBeUndefined()
    expect(testDb.prepare("SELECT created_by FROM medication_records WHERE id = 11").get()).toEqual({ created_by: token })

    const invited = applyRestoreAccounts(
      testDb, zipPath, new Map(), new Map(), new Map(),
      [{ bundle_id: 2, included: true }],
      inviter, "http://localhost", "admin@example.com",
    )
    expect(invited.result.invites_created).toBe(1)
    expect(testDb.prepare("SELECT email FROM accounts WHERE email = ?").get(REMOVED)).toEqual({ email: REMOVED })
    expect(testDb.prepare("SELECT created_by FROM medication_records WHERE id = 11").get()).toEqual({ created_by: token })
    const actors = testDb.prepare(
      "SELECT user_email FROM audit_log WHERE user_email = ?",
    ).all(REMOVED) as { user_email: string }[]
    expect(actors.every(row => row.user_email !== token)).toBe(true)
    expect(testDb.prepare("SELECT user_email FROM audit_log WHERE entity_id = 11 AND action = 'CREATE'").get()).toEqual({
      user_email: token,
    })
  })
})

function writeHouseholdZip(household: { accounts: unknown[] }): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "fc-remove-"))
  const path = join(dir, "export.zip")
  const payload = JSON.stringify({
    medications: [],
    groups: [],
    favourites: [],
    settings: [],
    catalogues: { observation_types: [], test_metrics: [] },
    ...household,
  })
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
    sink.on("finish", () => {
      writeFileSync(path, Buffer.concat(chunks))
      resolve(path)
    })
    archive.pipe(sink)
    archive.append(payload, { name: "household.json" })
    void archive.finalize()
  })
}
