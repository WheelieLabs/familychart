// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import AppHeader from "@/components/AppHeader"

vi.mock("next-auth/react", () => ({ signOut: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

function signedInAs(role: string | null) {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ role }),
  })))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openMenu() {
  render(<AppHeader title="Home" />)
  await screen.findByRole("button", { name: "Menu" })
  fireEvent.click(screen.getByRole("button", { name: "Menu" }))
}

describe("primary menu", () => {
  it("offers Data Export & Restore to an Admin", async () => {
    signedInAs("admin")
    await openMenu()
    const link = await screen.findByRole("link", { name: "Data Export & Restore" })
    expect(link.getAttribute("href")).toBe("/admin/export")
  })

  it("hides Data Export & Restore from an Account that is not an Admin", async () => {
    signedInAs("none")
    await openMenu()
    await screen.findByRole("link", { name: "Profile" })
    expect(screen.queryByRole("link", { name: "Data Export & Restore" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Administration" })).toBeNull()
  })
})
