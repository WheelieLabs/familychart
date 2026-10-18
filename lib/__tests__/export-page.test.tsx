// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import AdminExportPage from "@/app/(writable)/admin/export/export-page"
import { personExportStreamFinished, resetPersonExportDownloadsForTests } from "@/lib/export/download-person-export"

vi.mock("@/components/AppFooter", () => ({ default: () => null }))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "unauthenticated", data: null }),
  signOut: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}))

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => [],
  })))
})

afterEach(() => {
  cleanup()
  resetPersonExportDownloadsForTests()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("Data Export & Restore page", () => {
  it("is titled Data Export & Restore and trails back to Administration", async () => {
    render(<AdminExportPage />)
    expect(screen.getByRole("heading", { level: 1, name: "Data Export & Restore" })).toBeTruthy()
    const trail = screen.getByRole("navigation", { name: "Breadcrumb" })
    expect(trail.querySelector("a")?.getAttribute("href")).toBe("/admin/overview")
    expect(trail.querySelector("[aria-current='page']")?.textContent).toBe("Data Export & Restore")
  })

  it("lists an inactive Person, labelled Inactive, with a download", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("include_inactive=1")) {
        return {
          ok: true,
          json: async () => [{
            id: 3, name: "Robin", full_name: null, photo_url: null, color: "#3311AA",
            sort_order: 0, is_active: 0, account_uid: null, date_of_birth: "1950-01-01",
          }],
        }
      }
      return { ok: true, json: async () => ({ role: "admin" }) }
    }))
    render(<AdminExportPage />)
    const card = (await screen.findByText("Robin")).closest("li")
    expect(card).toBeTruthy()
    expect(within(card as HTMLElement).getByText("Inactive")).toBeTruthy()
    expect(within(card as HTMLElement).getByRole("button", { name: "Download export for Robin" })).toBeTruthy()
    expect(within(card as HTMLElement).getByRole("button", { name: "Reactivate Robin" })).toBeTruthy()
    expect(within(card as HTMLElement).getByRole("button", { name: "Erase Robin" })).toBeTruthy()
  })

  it("does not offer Reactivate or Erase for an active Person", async () => {
    renderPeople([person({})])
    const card = (await screen.findByText("Alex")).closest("li") as HTMLElement
    expect(within(card).queryByRole("button", { name: "Reactivate Alex" })).toBeNull()
    expect(within(card).queryByRole("button", { name: "Erase Alex" })).toBeNull()
  })

  it("drops the Inactive label after Reactivate succeeds", async () => {
    let active = 0
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/reactivate")) {
        active = 1
        return { ok: true, json: async () => ({}) }
      }
      if (String(url).includes("include_inactive=1")) {
        return {
          ok: true,
          json: async () => [{
            id: 3, name: "Robin", full_name: null, photo_url: null, color: "#3311AA",
            sort_order: 0, is_active: active, account_uid: null, date_of_birth: "1950-01-01",
          }],
        }
      }
      return { ok: true, json: async () => ({ role: "admin" }) }
    }))
    render(<AdminExportPage />)
    fireEvent.click(await screen.findByRole("button", { name: "Reactivate Robin" }))
    await waitFor(() => {
      expect(screen.queryByText("Inactive")).toBeNull()
    })
    expect(screen.queryByRole("button", { name: "Reactivate Robin" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Erase Robin" })).toBeNull()
  })

  function person(over: Record<string, unknown>) {
    return {
      id: 1, name: "Alex", full_name: null, photo_url: null, color: "#AA3311",
      sort_order: 0, is_active: 1, account_uid: null, date_of_birth: "2015-04-02",
      export_total_bytes: 42 * 1024 * 1024, export_report_bytes: 38 * 1024 * 1024,
      ...over,
    }
  }

  function renderPeople(rows: Record<string, unknown>[]) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("include_inactive=1")) return { ok: true, json: async () => rows }
      return { ok: true, json: async () => ({ role: "admin" }) }
    }))
    render(<AdminExportPage />)
  }

  it("shows the size estimate and warns that the file holds health information", async () => {
    renderPeople([person({})])
    expect(await screen.findByText("about 42 MB, including 38 MB of reports")).toBeTruthy()
    expect(screen.getByText(/not encrypted and holds health information/)).toBeTruthy()
    expect(screen.queryByText(/proxy may reject/)).toBeNull()
  })

  it("warns when an export is above 100 MB and not at 100 MB", async () => {
    renderPeople([person({ export_total_bytes: 100 * 1024 * 1024 })])
    await screen.findByText(/about 100 MB/)
    expect(screen.queryByText(/proxy may reject/)).toBeNull()
    cleanup()
    renderPeople([person({ id: 2, name: "Sam", export_total_bytes: 100 * 1024 * 1024 + 1, export_report_bytes: 90 * 1024 * 1024 })])
    expect(await screen.findByText(/proxy may reject/)).toBeTruthy()
    expect(screen.getByText(/individually/)).toBeTruthy()
  })

  it("records that the export stream has finished before it saves the file", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
    const saves: string[] = []
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:export")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(personExportStreamFinished(3)).toBe(true)
      saves.push(this.download)
    })
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = String(url)
      if (path.endsWith("/export")) {
        return {
          ok: true,
          headers: { get: (name: string) => name.toLowerCase() === "content-disposition" ? 'attachment; filename="Robin-export.zip"' : null },
          body,
        }
      }
      if (path.includes("include_inactive=1")) {
        return {
          ok: true,
          json: async () => [{
            id: 3, name: "Robin", full_name: null, photo_url: null, color: "#3311AA",
            sort_order: 0, is_active: 0, account_uid: null, date_of_birth: "1950-01-01",
          }],
        }
      }
      return { ok: true, json: async () => ({ role: "admin" }) }
    }))
    render(<AdminExportPage />)
    fireEvent.click(await screen.findByRole("button", { name: "Download export for Robin" }))
    const dialog = await screen.findByRole("dialog", { name: "Download export" })
    expect(dialog.textContent).toContain("This file is not encrypted and holds health information. Store it somewhere private.")
    fireEvent.click(within(dialog).getByRole("button", { name: "Download" }))
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/export"))).toBe(true))
    expect(personExportStreamFinished(3)).toBe(false)
    controller.enqueue(new Uint8Array([1, 2, 3]))
    expect(personExportStreamFinished(3)).toBe(false)
    controller.close()
    await waitFor(() => expect(personExportStreamFinished(3)).toBe(true))
    expect(saves).toEqual(["Robin-export.zip"])
  })

  it("keeps download disabled until the generated passphrase has been saved", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
      if (path.endsWith("/api/export/passphrase") && init?.method === "POST") {
        return { ok: true, json: async () => ({ passphrase: "23456 ABCDE FGHJK LMNPQ" }) }
      }
      if (path.includes("include_inactive=1")) return { ok: true, json: async () => [] }
      return { ok: true, json: async () => ({ role: "admin" }) }
    }))
    render(<AdminExportPage />)
    fireEvent.click(await screen.findByRole("button", { name: "Download household export" }))
    const dialog = await screen.findByRole("dialog", { name: "Download household export" })
    expect(dialog.textContent).toContain("This file is not encrypted and holds health information. Store it somewhere private.")
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Protect this file with a passphrase" }))
    expect(await within(dialog).findByText("23456 ABCDE FGHJK LMNPQ")).toBeTruthy()
    expect(within(dialog).getByText("Without this passphrase the file cannot be opened, by you or by us. We do not keep it.")).toBeTruthy()
    expect(within(dialog).getByRole("button", { name: "Download" })).toHaveProperty("disabled", true)
    expect(within(dialog).getByText("Tick that you've saved the passphrase.")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "I've saved the passphrase" }))
    expect(within(dialog).getByRole("button", { name: "Download" })).toHaveProperty("disabled", false)
    fireEvent.keyDown(window, { key: "Escape" })
    await waitFor(() => expect(screen.queryByText("23456 ABCDE FGHJK LMNPQ")).toBeNull())
  })
})
