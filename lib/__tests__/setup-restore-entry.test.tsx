// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import AdminExportPage from "@/app/(writable)/admin/export/export-page"
import SetupPage from "@/app/setup/page"
import type { SetupWizardContext } from "@/lib/setup-gate"

const { router } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
}))

vi.mock("@/components/AppHeader", () => ({ default: () => null }))
vi.mock("@/components/AppFooter", () => ({ default: () => null }))
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/setup",
  useSearchParams: () => new URLSearchParams(),
}))

const RESTORE = "Restore from an export instead"

function personStep(): SetupWizardContext {
  return {
    complete: false,
    passwordMinLength: 10,
    mode: "self-host",
    stage1Ready: true,
    bootstrapAllowed: false,
    ssoFinishEligible: false,
    showPersonStep: true,
    showSmtpStep: true,
    showMfaStep: false,
    authenticated: true,
    currentUserEmail: "admin@example.com",
    entraSignInAvailable: false,
    steps: ["person", "timezone", "smtp"],
    displaySteps: ["account", "person", "timezone", "smtp"],
    initialStep: "person",
  }
}

function atWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width })
}

beforeEach(() => {
  atWidth(1280)
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/api/setup/status")) {
      return { ok: true, json: async () => personStep() }
    }
    return { ok: true, json: async () => ({}) }
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("setup person step restore entry", () => {
  it("offers restore from an export on a desktop", async () => {
    atWidth(1280)
    render(<SetupPage />)
    const link = await screen.findByRole("link", { name: RESTORE })
    expect(link.getAttribute("href")).toBe("/admin/export?tab=restore")
    const posts = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter(call => String(call[0]).includes("/api/people"))
    expect(posts).toEqual([])
  })

  it("is absent below desktop width", async () => {
    atWidth(390)
    render(<SetupPage />)
    expect(await screen.findByRole("heading", { name: "Add your first person" })).toBeTruthy()
    expect(screen.queryByRole("link", { name: RESTORE })).toBeNull()
    expect(screen.queryByRole("button", { name: RESTORE })).toBeNull()
  })

  it("skips asking for a first person once people are already on the instance", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ ...personStep(), initialStep: "timezone" as const }),
    })))
    render(<SetupPage />)
    expect(await screen.findByRole("heading", { name: "Household timezone" })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Add your first person" })).toBeNull()
    expect(screen.queryByLabelText("Full name")).toBeNull()
    expect(screen.getByText("Person")).toBeTruthy()
  })
})

describe("restore screen during setup", () => {
  function exportFetches(complete: boolean) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = String(url)
      if (path.includes("/api/setup/status")) return { ok: true, json: async () => ({ complete }) }
      if (path.includes("/api/people")) return { ok: true, json: async () => [] }
      if (path.includes("/api/export/household/size")) {
        return { ok: true, json: async () => ({ bytes: 1024, reportBytes: 0 }) }
      }
      return { ok: true, json: async () => ({}) }
    }))
  }

  it("offers a way back to the wizard while setup is unfinished", async () => {
    exportFetches(false)
    render(<AdminExportPage />)
    const link = await screen.findByRole("link", { name: "Continue setup" })
    expect(link.getAttribute("href")).toBe("/setup")
    expect(screen.getByText(/instead of adding a first person/)).toBeTruthy()
  })

  it("hides that way back once setup is complete", async () => {
    exportFetches(true)
    render(<AdminExportPage />)
    expect(await screen.findByRole("button", { name: "Download household export" })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Continue setup" })).toBeNull()
  })
})
