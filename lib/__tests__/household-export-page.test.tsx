// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import AdminExportPage from "@/app/(writable)/admin/export/page"

vi.mock("@/components/AppHeader", () => ({ default: () => null }))
vi.mock("@/components/AppFooter", () => ({ default: () => null }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/export",
  useSearchParams: () => new URLSearchParams(),
}))

const LARGE = 101 * 1024 * 1024
const REPORTS = 100 * 1024 * 1024

function mockFetches(size: { bytes: number; reportBytes: number }) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/people")) return new Response(JSON.stringify([]))
    if (url.includes("/api/export/household/size")) return new Response(JSON.stringify(size))
    if (url.includes("/api/export/household")) return new Response(new Uint8Array([1, 2, 3]))
    return new Response(JSON.stringify({}))
  }))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("Data Export household download", () => {
  it("warns that the file holds health information and states the size", async () => {
    mockFetches({ bytes: 42 * 1024 * 1024, reportBytes: 38 * 1024 * 1024 })
    render(<AdminExportPage />)
    expect(screen.getByText(/health information/i)).toBeTruthy()
    expect(await screen.findByText("about 42 MB, including 38 MB of reports")).toBeTruthy()
    expect(screen.queryByText(/proxy may reject/i)).toBeNull()
  })

  it("warns when the estimate is over 100 MB", async () => {
    mockFetches({ bytes: LARGE, reportBytes: REPORTS })
    render(<AdminExportPage />)
    expect(await screen.findByText(/proxy may reject/i)).toBeTruthy()
    expect(screen.getByText("about 101 MB, including 100 MB of reports")).toBeTruthy()
  })

  it("downloads the household zip from the button", async () => {
    mockFetches({ bytes: 29, reportBytes: 14 })
    const click = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(click)
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:household")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
    render(<AdminExportPage />)
    fireEvent.click(await screen.findByRole("button", { name: "Download household export" }))
    fireEvent.click(await screen.findByRole("button", { name: "Download" }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    const calls = vi.mocked(fetch).mock.calls.map(call => String(call[0]))
    expect(calls.some(url => url.endsWith("/api/export/household"))).toBe(true)
  })
})
