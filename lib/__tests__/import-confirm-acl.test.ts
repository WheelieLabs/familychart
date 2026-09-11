// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"
import type { ImportRecord } from "@/lib/spreadsheet-import"

const rejectDemoImportProfanity = vi.fn(
  async (_records: ImportRecord[]): Promise<NextResponse | null> => null,
)
const authorisePersonAccess = vi.fn()

vi.mock("@/lib/auth/auth-helpers", () => ({
  requireAuth: vi.fn(async () => ({
    session: { user: { email: "demo@test", id: "local:1", groups: ["local:write"] } },
    groups: ["local:write"],
  })),
  authorisePersonAccess: (...args: unknown[]) =>
    authorisePersonAccess(...(args as Parameters<typeof authorisePersonAccess>)),
}))

vi.mock("@/lib/demo/demo-profanity-guard", () => ({
  rejectDemoImportProfanity: (records: ImportRecord[]) => rejectDemoImportProfanity(records),
}))

vi.mock("@/lib/db", () => ({
  getDb: () => ({}),
}))

vi.mock("@/lib/audit-log", () => ({
  auditLog: vi.fn(),
}))

vi.mock("@/lib/spreadsheet-import", () => ({
  importRecords: vi.fn(() => ({ imported: 0, observationsCreated: 0, errors: [] })),
}))

describe("POST /api/import/confirm ACL vs demo profanity order", () => {
  beforeEach(() => {
    vi.resetModules()
    rejectDemoImportProfanity.mockClear()
    rejectDemoImportProfanity.mockResolvedValue(null)
    authorisePersonAccess.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("returns 404 on denied write without calling demo purgomalum fan-out", async () => {
    authorisePersonAccess.mockReturnValue(
      NextResponse.json({ error: "Not found" }, { status: 404 }),
    )

    const { POST } = await import("@/app/api/import/confirm/route")
    const req = new NextRequest("http://localhost/api/import/confirm", {
      method: "POST",
      body: JSON.stringify({
        person_id: 99,
        records: [
          {
            date: "2026-01-01",
            time: "08:00",
            medication_name: "Paracetamol",
            dosage: 500,
            dosage_unit: "mg",
            weight_kg: null,
            comments: "clean local text for api path",
          },
        ],
      }),
      headers: { "content-type": "application/json" },
    })

    const res = await POST(req)
    expect(res.status).toBe(404)
    expect(rejectDemoImportProfanity).not.toHaveBeenCalled()
  })

  it("runs demo import profanity check after authorised write", async () => {
    authorisePersonAccess.mockReturnValue({
      id: 1,
      name: "Pat",
      account_uid: null,
      is_active: 1,
    })
    rejectDemoImportProfanity.mockResolvedValue(
      NextResponse.json({ error: "This content is not allowed in the demo environment." }, { status: 400 }),
    )

    const { POST } = await import("@/app/api/import/confirm/route")
    const req = new NextRequest("http://localhost/api/import/confirm", {
      method: "POST",
      body: JSON.stringify({
        person_id: 1,
        records: [
          {
            date: "2026-01-01",
            time: "08:00",
            medication_name: "Paracetamol",
            dosage: 500,
            dosage_unit: "mg",
            weight_kg: null,
            comments: "mild text only",
          },
        ],
      }),
      headers: { "content-type": "application/json" },
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(authorisePersonAccess).toHaveBeenCalled()
    expect(rejectDemoImportProfanity).toHaveBeenCalledOnce()
  })
})
