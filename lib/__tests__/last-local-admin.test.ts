// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { isLastLocalAdmin } from "@/lib/account/last-local-admin"
import { applyBaselineSchema } from "@/lib/db"

vi.mock("@/lib/db", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}))

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => session),
}))

let testDb: Database.Database
let session: { user: { id: string; email: string; groups?: string[] }; sessionVersion: number } | null

const LAST_ADMIN = { error: "Cannot remove the last local Admin" }

/** Admin 1 is the signed-in, active Admin. Admin 2 is the other one, in the state under test. */
function setOtherAdmin(state: "active" | "disabled" | "invited" | "none" | "entra" | "non-admin") {
  testDb.prepare("DELETE FROM accounts WHERE id = 2").run()
  if (state === "none") return
  const row = {
    active: ["admin", 1, "local", "active"],
    disabled: ["admin", 0, "local", "active"],
    invited: ["admin", 1, "local", "invited"],
    entra: ["admin", 1, "entra", "active"],
    "non-admin": ["write", 1, "local", "active"],
  }[state]
  testDb.prepare(
    "INSERT INTO accounts (id, email, role, is_active, auth_method, status) VALUES (2, 'other@example.com', ?, ?, ?, ?)",
  ).run(...row)
}

describe("isLastLocalAdmin", () => {
  beforeEach(() => {
    testDb = new Database(":memory:")
    applyBaselineSchema(testDb)
    testDb.prepare(
      "INSERT INTO accounts (id, email, role, is_active, auth_method, status) VALUES (1, 'admin@example.com', 'admin', 1, 'local', 'active')",
    ).run()
  })
  afterEach(() => testDb.close())

  it.each([
    ["another active local Admin", "active", false],
    ["only a disabled local Admin", "disabled", true],
    ["only a pending Invite", "invited", true],
    ["only an Entra Admin", "entra", true],
    ["only a non-Admin", "non-admin", true],
    ["nobody else", "none", true],
  ] as const)("with %s", (_label, state, expected) => {
    setOtherAdmin(state)
    expect(isLastLocalAdmin(testDb, 1)).toBe(expected)
  })

  it("is false for an Entra Account and for a non-Admin", () => {
    setOtherAdmin("entra")
    expect(isLastLocalAdmin(testDb, 2)).toBe(false)
    setOtherAdmin("non-admin")
    expect(isLastLocalAdmin(testDb, 2)).toBe(false)
  })
})

describe("the last active local Admin is protected while the other Admin is disabled", () => {
  beforeEach(() => {
    testDb = new Database(":memory:")
    applyBaselineSchema(testDb)
    testDb.prepare(
      "INSERT INTO accounts (id, email, role, is_active, auth_method, status) VALUES (1, 'admin@example.com', 'admin', 1, 'local', 'active')",
    ).run()
    session = { user: { id: "local:1", email: "admin@example.com" }, sessionVersion: 0 }
  })
  afterEach(() => testDb.close())

  async function edit(body: Record<string, unknown>) {
    const { PUT } = await import("@/app/api/accounts/[id]/route")
    return PUT(new NextRequest("http://localhost/api/accounts/1", { method: "PUT", body: JSON.stringify(body) }), {
      params: Promise.resolve({ id: "1" }),
    })
  }

  async function adminRemove() {
    // Removal by an Admin is of another Account, so the caller is a different Admin on an Entra session.
    session = { user: { id: "entra-admin", email: "entra@example.com", groups: ["local:admin"] }, sessionVersion: 0 }
    const { POST } = await import("@/app/api/accounts/[id]/remove/route")
    return POST(new NextRequest("http://localhost/api/accounts/1/remove", {
      method: "POST",
      body: JSON.stringify({ email: "admin@example.com" }),
    }), { params: Promise.resolve({ id: "1" }) })
  }

  async function selfRemove() {
    const { POST } = await import("@/app/api/me/remove-account/route")
    return POST(new NextRequest("http://localhost/api/me/remove-account", {
      method: "POST",
      body: JSON.stringify({ password: "whatever" }),
    }))
  }

  async function erase() {
    testDb.exec(`
      INSERT INTO people (id, name, account_uid, is_active) VALUES (9, 'Self', 'local:1', 0);
    `)
    const { POST } = await import("@/app/api/people/[id]/erase/route")
    const res = await POST(new NextRequest("http://localhost/api/people/9/erase", {
      method: "POST",
      body: JSON.stringify({ remove_account: true }),
    }), { params: Promise.resolve({ id: "9" }) })
    return res
  }

  describe("with the other Admin disabled", () => {
    beforeEach(() => setOtherAdmin("disabled"))

    it("refuses demotion and deactivation through the edit route", async () => {
      const demote = await edit({ role: "read" })
      expect(demote.status).toBe(400)
      expect(await demote.json()).toEqual(LAST_ADMIN)
      const deactivate = await edit({ is_active: 0 })
      expect(deactivate.status).toBe(400)
      expect(await deactivate.json()).toEqual(LAST_ADMIN)
      expect(testDb.prepare("SELECT role, is_active FROM accounts WHERE id = 1").get()).toEqual({ role: "admin", is_active: 1 })
    })

    it("refuses permanent removal by an Admin and by the holder", async () => {
      const byAdmin = await adminRemove()
      expect(byAdmin.status).toBe(400)
      expect(await byAdmin.json()).toEqual(LAST_ADMIN)

      session = { user: { id: "local:1", email: "admin@example.com" }, sessionVersion: 0 }
      const bySelf = await selfRemove()
      expect(bySelf.status).toBe(400)
      expect(await bySelf.json()).toEqual(LAST_ADMIN)
      expect(testDb.prepare("SELECT id FROM accounts WHERE id = 1").get()).toEqual({ id: 1 })
    })

    it("keeps the Account when the erase option asks to remove it", async () => {
      session = { user: { id: "entra-admin", email: "entra@example.com", groups: ["local:admin"] }, sessionVersion: 0 }
      const res = await erase()
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ account_outcome: "kept" })
      expect(testDb.prepare("SELECT role, is_active FROM accounts WHERE id = 1").get()).toEqual({ role: "admin", is_active: 1 })
    })
  })

  describe("with two active Admins", () => {
    beforeEach(() => setOtherAdmin("active"))

    it("still allows demotion, deactivation and removal", async () => {
      expect((await edit({ role: "read" })).status).toBe(200)
      testDb.prepare("UPDATE accounts SET role = 'admin', session_version = 0 WHERE id = 1").run()
      expect((await edit({ is_active: 0 })).status).toBe(200)
      testDb.prepare("UPDATE accounts SET is_active = 1, session_version = 0 WHERE id = 1").run()
      expect((await adminRemove()).status).toBe(200)
      expect(testDb.prepare("SELECT id FROM accounts WHERE id = 1").get()).toBeUndefined()
    })

    it("still removes the Account through the erase option", async () => {
      session = { user: { id: "entra-admin", email: "entra@example.com", groups: ["local:admin"] }, sessionVersion: 0 }
      const res = await erase()
      expect(await res.json()).toMatchObject({ account_outcome: "removed" })
    })
  })
})
