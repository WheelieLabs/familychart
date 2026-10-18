// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import AdminOverviewPage from "@/app/(writable)/admin/overview/page"
import { getEntraRevalidationGap } from "@/lib/auth/entra-revalidation-gap"
import { isEntraProviderActive } from "@/lib/settings/auth-settings"

vi.mock("@/components/AppHeader", () => ({ default: () => null }))
vi.mock("@/components/AppFooter", () => ({ default: () => null }))
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }))
vi.mock("@/lib/auth/entra-revalidation-gap", () => ({
  getEntraRevalidationGap: vi.fn(() => null),
}))
vi.mock("@/lib/settings/auth-settings", () => ({
  isEntraProviderActive: vi.fn(() => false),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Administration hub", () => {
  it("does not show a Database placeholder tile", () => {
    render(<AdminOverviewPage />)
    expect(screen.queryByText("Database")).toBeNull()
    expect(screen.queryByText("Coming soon")).toBeNull()
    expect(screen.queryByText("Backup and maintenance tools")).toBeNull()
  })

  it("still links to the other admin destinations", () => {
    render(<AdminOverviewPage />)
    expect(screen.getByRole("link", { name: /Accounts/ }).getAttribute("href")).toBe("/admin/accounts")
    expect(screen.getByRole("link", { name: /Data Export & Restore/ }).getAttribute("href")).toBe("/admin/export")
    expect(screen.getByRole("link", { name: /Audit Log/ }).getAttribute("href")).toBe("/admin/audit-log")
  })

  it("shows Entra Sessions when Entra sign-in is active", () => {
    vi.mocked(isEntraProviderActive).mockReturnValue(true)
    render(<AdminOverviewPage />)
    expect(screen.getByRole("link", { name: /Entra Sessions/ }).getAttribute("href")).toBe("/admin/entra-sessions")
  })

  it("shows no Entra warning when there is no revalidation gap", () => {
    render(<AdminOverviewPage />)
    expect(screen.queryByText("Warning:")).toBeNull()
  })

  it("shows the short Entra warning when access is not being rechecked", () => {
    vi.mocked(getEntraRevalidationGap).mockReturnValue({ graphConfigured: false, usersWithoutGroupData: 0 })
    render(<AdminOverviewPage />)
    expect(screen.getByText("Warning:")).toBeTruthy()
    expect(screen.getByText("isn't being rechecked", { exact: false })).toBeTruthy()
  })
})
