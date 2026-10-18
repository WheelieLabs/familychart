// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import AccountsAdminClient from "@/app/(writable)/admin/accounts/AccountsAdminClient"

vi.mock("@/components/AppHeader", () => ({ default: () => null }))
vi.mock("@/components/AppFooter", () => ({ default: () => null }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/admin/accounts",
}))

const FUTURE = new Date(Date.now() + 7 * 864e5).toISOString()
const PAST = new Date(Date.now() - 7 * 864e5).toISOString()

function row(over: Record<string, unknown>) {
  return {
    id: 1, email: "a@example.com", role: "read", can_report: 0, is_active: 1, auth_method: "local",
    status: "active", invite_expires_at: null, invite_revoked_at: null, mfa_enrolled: 1,
    created_at: "2026-08-01 00:00:00", ...over,
  }
}

const ROWS = [
  row({ id: 1, email: "disabled@example.com", is_active: 0 }),
  row({ id: 2, email: "active@example.com" }),
  row({ id: 3, email: "invited@example.com", status: "invited", invite_expires_at: FUTURE }),
  row({ id: 4, email: "expired@example.com", status: "invited", invite_expires_at: PAST }),
  row({ id: 5, email: "revoked@example.com", status: "invited", invite_expires_at: FUTURE, invite_revoked_at: PAST }),
  row({ id: 6, email: "entra@example.com", auth_method: "entra", is_active: 0 }),
  row({ id: 7, email: "disabled-invite@example.com", is_active: 0, status: "invited", invite_expires_at: FUTURE }),
]

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (url.includes("/api/accounts/invites") ? ROWS : []),
  })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function renderList() {
  render(<AccountsAdminClient entraActive emailConfigured />)
  await screen.findByText("disabled@example.com")
}

function card(email: string): HTMLElement {
  const el = screen.getByText(email).closest("li")
  if (!el) throw new Error(`No row for ${email}`)
  return el
}

describe("Accounts list", () => {
  it("shows one combined chip per row and no separate sign-in text", async () => {
    await renderList()
    const chips: Record<string, string> = {
      "disabled@example.com": "Disabled",
      "active@example.com": "Active",
      "invited@example.com": "Invited",
      "expired@example.com": "Expired",
      "revoked@example.com": "Revoked",
      "entra@example.com": "Active",
      "disabled-invite@example.com": "Disabled",
    }
    for (const [email, chip] of Object.entries(chips)) {
      expect(within(card(email)).getByText(chip)).toBeTruthy()
    }
    expect(screen.queryByText(/Can sign in|Sign-in disabled/)).toBeNull()
    expect(within(card("disabled@example.com")).queryByText("Active")).toBeNull()
  })

  it("dims disabled local rows but not an Entra row with is_active off", async () => {
    await renderList()
    expect(card("disabled@example.com").classList.contains("fc-card--inactive")).toBe(true)
    expect(card("entra@example.com").classList.contains("fc-card--inactive")).toBe(false)
    expect(within(card("disabled@example.com")).getByRole("button", { name: /Edit/ })).toBeTruthy()
  })

  it("shows Revoke and Resend by invite state, even on a disabled row", async () => {
    await renderList()
    const has = (email: string, name: RegExp) => within(card(email)).queryByRole("button", { name }) != null
    expect(has("invited@example.com", /Revoke invite/)).toBe(true)
    expect(has("invited@example.com", /Resend invite/)).toBe(true)
    expect(has("expired@example.com", /Revoke invite/)).toBe(false)
    expect(has("expired@example.com", /Resend invite/)).toBe(true)
    expect(has("revoked@example.com", /Resend invite/)).toBe(true)
    expect(has("disabled-invite@example.com", /Revoke invite/)).toBe(true)
    expect(has("disabled-invite@example.com", /Resend invite/)).toBe(true)
    expect(has("disabled@example.com", /Revoke invite|Resend invite/)).toBe(false)
    expect(has("active@example.com", /Revoke invite|Resend invite/)).toBe(false)
  })
})

describe("Edit Account", () => {
  async function openEdit(email: string) {
    await renderList()
    fireEvent.click(within(card(email)).getByRole("button", { name: /Edit/ }))
    await screen.findByText("Edit Account")
  }

  it("offers a Sign-in enabled switch with helper text for a local account", async () => {
    await openEdit("disabled@example.com")
    const sw = screen.getByRole("switch", { name: "Sign-in enabled" })
    expect(sw.getAttribute("aria-checked")).toBe("false")
    expect(screen.getByText("Turning this off blocks sign-in immediately.")).toBeTruthy()
    expect(screen.queryByRole("switch", { name: "Account active" })).toBeNull()
  })

  it("hides the switch for an Entra account and points at Entra", async () => {
    await openEdit("entra@example.com")
    expect(screen.queryByRole("switch", { name: "Sign-in enabled" })).toBeNull()
    expect(screen.getByText(/Sign-in for this account is controlled in Entra/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Entra Sessions" })).toBeTruthy()
  })

  it("does not send is_active when saving an Entra account", async () => {
    await openEdit("entra@example.com")
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => {
      const put = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === "PUT")
      expect(put).toBeTruthy()
      expect(JSON.parse((put![1] as RequestInit).body as string)).not.toHaveProperty("is_active")
    })
  })
})
