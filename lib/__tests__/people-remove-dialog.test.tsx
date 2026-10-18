// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import ManagePeoplePage from "@/app/(writable)/management/people/page"

vi.mock("@/components/AppFooter", () => ({ default: () => null }))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "unauthenticated", data: null }),
  signOut: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/management/people",
  useSearchParams: () => new URLSearchParams(),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("Remove person dialog", () => {
  it("explains that records stay and can be exported or erased from Data Export & Restore", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => [{
        id: 3, name: "Robin", full_name: null, photo_url: null, color: "#3311AA",
        sort_order: 0, is_active: 1, account_uid: null, date_of_birth: null,
      }],
    })))
    render(<ManagePeoplePage />)
    fireEvent.click(await screen.findByRole("button", { name: "Remove Robin" }))
    const dialog = screen.getByRole("dialog", { name: "Remove this person?" })
    expect(dialog.textContent).toContain(
      "They'll no longer appear in your family list. Their records stay stored and can be exported or deleted permanently from Data Export & Restore.",
    )
  })
})
