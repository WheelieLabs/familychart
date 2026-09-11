// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const rejectDemoProfanity = vi.fn(async (): Promise<NextResponse | null> => null)
let existingPersonRow: Record<string, unknown> | undefined

vi.mock("@/lib/auth/auth-helpers", () => ({
  requireManage: vi.fn(async () => ({
    session: { user: { email: "demo@test", id: "local:1", groups: ["local:admin"] } },
    groups: ["local:admin"],
  })),
  requireAuth: vi.fn(async () => ({
    session: { user: { email: "demo@test", id: "local:1", groups: ["local:admin"] } },
    groups: ["local:admin"],
  })),
  authorisePersonAccess: vi.fn(),
}))

vi.mock("@/lib/demo/demo-profanity-guard", () => ({
  rejectDemoProfanity: (...args: unknown[]) =>
    rejectDemoProfanity(...(args as Parameters<typeof rejectDemoProfanity>)),
}))

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    prepare: () => ({
      get: () => existingPersonRow,
      run: vi.fn(),
    }),
  }),
}))

vi.mock("@/lib/audit-log", () => ({
  auditLog: vi.fn(),
}))

describe("PUT /api/people/[id] existence check vs demo profanity order", () => {
  beforeEach(() => {
    vi.resetModules()
    rejectDemoProfanity.mockClear()
    rejectDemoProfanity.mockResolvedValue(null)
    existingPersonRow = undefined
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  function makeRequest(body: Record<string, unknown>) {
    return new NextRequest("http://localhost/api/people/1", {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  }

  it("returns 404 for a missing Person without calling the demo profanity guard", async () => {
    existingPersonRow = undefined

    const { PUT } = await import("@/app/api/people/[id]/route")
    const res = await PUT(makeRequest({ name: "New Name" }), { params: Promise.resolve({ id: "1" }) })

    expect(res.status).toBe(404)
    expect(rejectDemoProfanity).not.toHaveBeenCalled()
  })

  it("runs the demo profanity guard once an existing Person is found", async () => {
    existingPersonRow = {
      id: 1,
      name: "Pat",
      full_name: null,
      photo_url: null,
      color: "#000",
      sort_order: 0,
      account_uid: null,
      date_of_birth: null,
      is_active: 1,
    }
    rejectDemoProfanity.mockResolvedValue(
      NextResponse.json({ error: "This content is not allowed in the demo environment." }, { status: 400 }),
    )

    const { PUT } = await import("@/app/api/people/[id]/route")
    const res = await PUT(makeRequest({ name: "New Name" }), { params: Promise.resolve({ id: "1" }) })

    expect(res.status).toBe(400)
    expect(rejectDemoProfanity).toHaveBeenCalledOnce()
  })
})
