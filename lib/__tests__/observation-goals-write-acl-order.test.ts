// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const rejectDemoProfanity = vi.fn(async (): Promise<NextResponse | null> => null)
const authorisePersonAccess = vi.fn()

vi.mock("@/lib/auth/auth-helpers", () => ({
  requireRead: vi.fn(async () => ({
    session: { user: { email: "demo@test", id: "local:1", groups: ["local:write"] } },
    groups: ["local:write"],
  })),
  requireAuth: vi.fn(async () => ({
    session: { user: { email: "demo@test", id: "local:1", groups: ["local:write"] } },
    groups: ["local:write"],
  })),
  authorisePersonAccess: (...args: unknown[]) =>
    authorisePersonAccess(...(args as Parameters<typeof authorisePersonAccess>)),
}))

vi.mock("@/lib/demo/demo-profanity-guard", () => ({
  rejectDemoProfanity: (...args: unknown[]) =>
    rejectDemoProfanity(...(args as Parameters<typeof rejectDemoProfanity>)),
}))

vi.mock("@/lib/db", () => ({
  getDb: () => ({}),
}))

vi.mock("@/lib/audit-log", () => ({
  auditLog: vi.fn(),
}))

vi.mock("@/lib/observation/observation-goals", () => ({
  setObservationGoal: vi.fn(),
  getObservationGoal: vi.fn(),
  deleteObservationGoal: vi.fn(),
}))

describe("POST /api/observation-goals ACL vs demo profanity order", () => {
  beforeEach(() => {
    vi.resetModules()
    rejectDemoProfanity.mockClear()
    rejectDemoProfanity.mockResolvedValue(null)
    authorisePersonAccess.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  function makeRequest(body: Record<string, unknown>) {
    return new NextRequest("http://localhost/api/observation-goals", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  }

  it("returns the ACL denial without calling the demo profanity guard", async () => {
    authorisePersonAccess.mockReturnValue(NextResponse.json({ error: "Not found" }, { status: 404 }))

    const { POST } = await import("@/app/api/observation-goals/route")
    const res = await POST(
      makeRequest({ person_id: 99, observation_type: "Weight", target_value: 70, unit: "kg" }),
    )

    expect(res.status).toBe(404)
    expect(rejectDemoProfanity).not.toHaveBeenCalled()
  })

  it("runs the demo profanity guard after an authorised write", async () => {
    authorisePersonAccess.mockReturnValue({ id: 1, name: "Pat", account_uid: null, is_active: 1 })
    rejectDemoProfanity.mockResolvedValue(
      NextResponse.json({ error: "This content is not allowed in the demo environment." }, { status: 400 }),
    )

    const { POST } = await import("@/app/api/observation-goals/route")
    const res = await POST(
      makeRequest({ person_id: 1, observation_type: "Weight", target_value: 70, unit: "kg" }),
    )

    expect(res.status).toBe(400)
    expect(authorisePersonAccess).toHaveBeenCalled()
    expect(rejectDemoProfanity).toHaveBeenCalledOnce()
  })
})
