// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import ErasePersonPage from "@/app/(writable)/admin/export/[id]/erase/ErasePersonPage"
import { resetPersonExportDownloadsForTests } from "@/lib/export/download-person-export"

vi.mock("@/components/AppFooter", () => ({ default: () => null }))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "unauthenticated", data: null }),
  signOut: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/export/3/erase",
  useSearchParams: () => new URLSearchParams(),
}))

const PREVIEW = {
  name: "Robin",
  is_active: 0,
  counts_label: "34 doses, 12 observations, 3 test results with reports, 1 photo",
  backup_notice: "Backups taken before this erase may still contain this person.",
  account: null as null | {
    email: string
    role: string
    remove_default: boolean
    remove_blocked_reason: string | null
    is_own: boolean
    is_local: boolean
    mfa_enrolled: boolean
  },
}

afterEach(() => {
  cleanup()
  resetPersonExportDownloadsForTests()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function stub(preview = PREVIEW, result?: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url)
    if (path.endsWith("/erase") && init?.method === "POST") {
      return { ok: true, json: async () => result }
    }
    if (path.endsWith("/erase")) return { ok: true, json: async () => preview }
    return { ok: true, json: async () => ({ role: "admin" }) }
  }))
}

describe("Erase Person page", () => {
  it("shows the counts and backup notice, and keeps Erase off until the name matches", async () => {
    stub()
    render(<ErasePersonPage personId="3" />)
    expect(screen.getByRole("heading", { level: 1, name: "Erase Person" })).toBeTruthy()
    const trail = screen.getByRole("navigation", { name: "Breadcrumb" })
    expect(trail.querySelector("a[href='/admin/export']")).toBeTruthy()
    expect(trail.querySelector("[aria-current='page']")?.textContent).toBe("Erase Person")

    expect(await screen.findByText(PREVIEW.counts_label)).toBeTruthy()
    expect(screen.getByText(PREVIEW.backup_notice)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Download export first" })).toBeTruthy()

    const erase = screen.getByRole("button", { name: "Erase" })
    expect((erase as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText("Type their name exactly.")).toBeTruthy()

    const name = screen.getByRole("textbox", { name: "Type their name" })
    fireEvent.change(name, { target: { value: "Rob" } })
    fireEvent.blur(name)
    expect(await screen.findByText("Type Robin exactly.")).toBeTruthy()
    expect(name.getAttribute("aria-invalid")).toBe("true")

    fireEvent.change(name, { target: { value: "Robin" } })
    fireEvent.blur(name)
    await waitFor(() => expect((screen.getByRole("button", { name: "Erase" }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.queryByText("Type Robin exactly.")).toBeNull()
  })

  it("tells an Admin to deactivate an active Person before erasing them", async () => {
    stub({ ...PREVIEW, is_active: 1 })
    render(<ErasePersonPage personId="3" />)
    expect(await screen.findByText("Deactivate this person before erasing them.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Erase" })).toBeNull()
  })

  it("says a household account stays, and a None-role account is signed out", async () => {
    stub(PREVIEW, {
      erased_at: "2026-10-09T00:00:00.000Z",
      erase_again: "If you ever restore a backup taken before this date, erase this person again.",
      account_outcome: "kept",
      account_note: "This account has a household role, so it was left able to sign in.",
      file_failures: [],
    })
    render(<ErasePersonPage personId="3" />)
    fireEvent.change(await screen.findByRole("textbox", { name: "Type their name" }), { target: { value: "Robin" } })
    fireEvent.click(screen.getByRole("button", { name: "Erase" }))
    expect(await screen.findByText("This account stays unless an administrator removes it.")).toBeTruthy()
    expect(screen.getByText("This account has a household role, so it was left able to sign in.")).toBeTruthy()
    expect(screen.getByText("Erased on 9 Oct 2026.")).toBeTruthy()
    expect(screen.getByText("If you ever restore a backup taken before this date, erase this person again.")).toBeTruthy()

    cleanup()
    stub(PREVIEW, {
      erased_at: "2026-10-09T00:00:00.000Z",
      erase_again: "If you ever restore a backup taken before this date, erase this person again.",
      account_outcome: "deactivated",
      account_note: null,
      file_failures: [],
    })
    render(<ErasePersonPage personId="3" />)
    fireEvent.change(await screen.findByRole("textbox", { name: "Type their name" }), { target: { value: "Robin" } })
    fireEvent.click(screen.getByRole("button", { name: "Erase" }))
    expect(await screen.findByText("This account has been deactivated and the person is signed out.")).toBeTruthy()
  })

  it("keeps Erase off, with a reason, while an export from this page is still downloading", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:export")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = String(url)
      if (path.endsWith("/export")) {
        return {
          ok: true,
          headers: { get: () => 'attachment; filename="Robin-export.zip"' },
          body,
        }
      }
      if (path.endsWith("/erase")) return { ok: true, json: async () => PREVIEW }
      return { ok: true, json: async () => ({ role: "admin" }) }
    }))
    render(<ErasePersonPage personId="3" />)
    fireEvent.change(await screen.findByRole("textbox", { name: "Type their name" }), { target: { value: "Robin" } })
    fireEvent.click(screen.getByRole("button", { name: "Download export first" }))
    expect(await screen.findByText("An export of this person is still downloading.")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Erase" }) as HTMLButtonElement).disabled).toBe(true)
    controller.close()
    await waitFor(() => {
      expect(screen.queryByText("An export of this person is still downloading.")).toBeNull()
      expect((screen.getByRole("button", { name: "Erase" }) as HTMLButtonElement).disabled).toBe(false)
    })
  })

  it("offers to remove the linked Account, on for Role None and off when the last local Admin would be removed", async () => {
    stub({
      ...PREVIEW,
      account: { email: "sam@example.com", role: "none", remove_default: true, remove_blocked_reason: null, is_own: false, is_local: true, mfa_enrolled: false },
    })
    render(<ErasePersonPage personId="3" />)
    const on = await screen.findByRole("switch", { name: "Also permanently remove their Account" })
    expect(on.getAttribute("aria-checked")).toBe("true")
    expect((on as HTMLButtonElement).disabled).toBe(false)

    cleanup()
    stub({
      ...PREVIEW,
      account: {
        email: "admin@example.com",
        role: "admin",
        remove_default: false,
        remove_blocked_reason: "Cannot remove the last local Admin",
        is_own: true,
        is_local: true,
        mfa_enrolled: false,
      },
    })
    render(<ErasePersonPage personId="3" />)
    const blocked = await screen.findByRole("switch", { name: "Also permanently remove their Account" })
    expect(blocked.getAttribute("aria-checked")).toBe("false")
    expect((blocked as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText("Cannot remove the last local Admin")).toBeTruthy()
  })

  it("asks an Admin for their password only when the Account being removed is their own", async () => {
    stub({
      ...PREVIEW,
      account: {
        email: "admin@example.com",
        role: "admin",
        remove_default: false,
        remove_blocked_reason: null,
        is_own: true,
        is_local: true,
        mfa_enrolled: false,
      },
    })
    render(<ErasePersonPage personId="3" />)
    const toggle = await screen.findByRole("switch", { name: "Also permanently remove their Account" })
    expect(screen.queryByLabelText("Password for this erase")).toBeNull()
    fireEvent.click(toggle)
    expect(await screen.findByLabelText("Password for this erase")).toBeTruthy()
    fireEvent.click(toggle)
    expect(screen.queryByLabelText("Password for this erase")).toBeNull()
  })
})
