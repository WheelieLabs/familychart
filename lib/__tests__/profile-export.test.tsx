// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import ProfilePage from "@/app/profile/page"

vi.mock("@/components/AppFooter", () => ({ default: () => null }))
vi.mock("next-auth/react", () => ({ signIn: vi.fn(), signOut: vi.fn(), useSession: () => ({ status: "unauthenticated", data: null }) }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/profile",
  useSearchParams: () => new URLSearchParams("tab=account"),
}))

const MB = 1024 * 1024

function me(role: string | null, linked: boolean) {
  return {
    id: "local:2",
    name: "Sam",
    email: "sam@example.com",
    image: null,
    role,
    isLocal: true,
    needsMfaEnrollment: false,
    mfaEnrolled: true,
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

function renderProfile(role: string | null, linked: boolean, totalBytes = 42 * MB) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = String(url)
    if (path.includes("/api/me") && !path.includes("/api/me/")) {
      return { ok: true, json: async () => me(role, linked) }
    }
    if (path.includes("/export/estimate")) {
      return { ok: true, json: async () => ({ total_bytes: totalBytes, report_bytes: 38 * MB }) }
    }
    return { ok: true, json: async () => [] }
  }))
  render(<ProfilePage />)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("Profile export", () => {
  it.each(["none", "readonly", "readwrite", "manager", "admin"])(
    "offers Export my data to a linked %s Account",
    async role => {
      renderProfile(role, true)
      expect(await screen.findByRole("button", { name: "Export my data" })).toBeTruthy()
      expect(await screen.findByText("about 42 MB, including 38 MB of reports")).toBeTruthy()
      expect(screen.getByText(/not encrypted and holds health information/)).toBeTruthy()
      expect(screen.queryByRole("link", { name: "Data Export & Restore" })).toBeNull()
    },
  )

  it("hides Export my data when the Account has no Personal-link", async () => {
    renderProfile("none", false)
    await screen.findByRole("heading", { name: "Authenticator app" })
    expect(screen.queryByRole("button", { name: "Export my data" })).toBeNull()
  })

  it("warns a linked Account when their export is above 100 MB", async () => {
    renderProfile("none", true, 100 * MB + 1)
    expect(await screen.findByText(/proxy may reject/)).toBeTruthy()
  })
})
