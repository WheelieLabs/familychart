// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import ProfilePage from "@/app/profile/page"

vi.mock("@/components/AppFooter", () => ({ default: () => null }))
vi.mock("next-auth/react", () => ({ signIn: vi.fn(), signOut: vi.fn(), useSession: () => ({ status: "unauthenticated", data: null }) }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/profile",
  useSearchParams: () => new URLSearchParams("tab=account"),
}))

const PREVIEW = {
  name: "Sam",
  is_active: 1,
  counts_label: "1 dose, 1 observation, 0 test results with reports, 0 photos",
  backup_notice: "Backups taken before this erase may still contain this person.",
}

function me(linked: boolean, mfaEnrolled = false) {
  return {
    id: "local:2",
    name: "Sam",
    email: "sam@example.com",
    image: null,
    role: "none",
    isLocal: true,
    needsMfaEnrollment: false,
    mfaEnrolled,
    mfaPolicyRequired: false,
    passwordMinLength: 10,
    measurementSystem: "metric",
    instanceTimezone: "UTC",
    linkedPerson: linked
      ? { id: 2, name: "Sam", full_name: "Sam Example", photo_url: null, color: "#11AA33" }
      : null,
    hydrationGoalMl: null,
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("Profile self-service erase", () => {
  it("hides erase when the Account has no Personal-link", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => me(false) })))
    render(<ProfilePage />)
    await screen.findByRole("heading", { name: "Authenticator app" })
    expect(screen.queryByRole("button", { name: "Erase my records" })).toBeNull()
  })

  it("erases the linked Person after a password, and says a None-role account is signed out", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
      if (path.endsWith("/erase") && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            erased_at: "2026-10-09T00:00:00.000Z",
            erase_again: "If you ever restore a backup taken before this date, erase this person again.",
            account_outcome: "deactivated",
            account_note: null,
            file_failures: [],
          }),
        }
      }
      if (path.endsWith("/erase")) return { ok: true, json: async () => PREVIEW }
      if (path.includes("/api/me") && !path.includes("/api/me/")) return { ok: true, json: async () => me(true) }
      if (path.includes("/export/estimate")) return { ok: true, json: async () => ({ total_bytes: 0, report_bytes: 0 }) }
      return { ok: true, json: async () => [] }
    }))
    render(<ProfilePage />)
    fireEvent.click(await screen.findByRole("button", { name: "Erase my records" }))
    expect(await screen.findByText(PREVIEW.counts_label)).toBeTruthy()
    expect(screen.getByText(PREVIEW.backup_notice)).toBeTruthy()
    expect(screen.getByText("This takes you off the family list and erases your records in one step.")).toBeTruthy()

    fireEvent.change(screen.getByRole("textbox", { name: "Type their name" }), { target: { value: "Sam" } })
    expect(screen.getByText("Confirm your password to erase your records.")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Password for this erase"), { target: { value: "sam-secret" } })
    fireEvent.click(screen.getByRole("button", { name: "Erase" }))

    expect(await screen.findByText("This account has been deactivated and the person is signed out.")).toBeTruthy()
    const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST")
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ password: "sam-secret" })
  })

  it("says the account stays when it has a household role", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
      if (path.endsWith("/erase") && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            erased_at: "2026-10-09T00:00:00.000Z",
            erase_again: "If you ever restore a backup taken before this date, erase this person again.",
            account_outcome: "kept",
            account_note: "This account has a household role, so it was left able to sign in.",
            file_failures: [],
          }),
        }
      }
      if (path.endsWith("/erase")) return { ok: true, json: async () => PREVIEW }
      if (path.includes("/api/me") && !path.includes("/api/me/")) {
        return { ok: true, json: async () => ({ ...me(true), role: "readwrite" }) }
      }
      if (path.includes("/export/estimate")) return { ok: true, json: async () => ({ total_bytes: 0, report_bytes: 0 }) }
      return { ok: true, json: async () => [] }
    }))
    render(<ProfilePage />)
    fireEvent.click(await screen.findByRole("button", { name: "Erase my records" }))
    fireEvent.change(await screen.findByRole("textbox", { name: "Type their name" }), { target: { value: "Sam" } })
    fireEvent.change(screen.getByLabelText("Password for this erase"), { target: { value: "sam-secret" } })
    fireEvent.click(screen.getByRole("button", { name: "Erase" }))
    expect(await screen.findByText("This account stays unless an administrator removes it.")).toBeTruthy()
    expect(screen.getByText("This account has a household role, so it was left able to sign in.")).toBeTruthy()
  })
})
