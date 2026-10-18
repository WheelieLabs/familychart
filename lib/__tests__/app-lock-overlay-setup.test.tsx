// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import AppLockOverlay from "@/components/AppLockOverlay"
import {
  __setWebAuthnAdapterForTests,
  readBiometricCredentialId,
  type WebAuthnAdapter,
} from "@/lib/webauthn-app-lock"

/**
 * First App lock set-up needs the server-verified grant too (ADR-0016): granted silently for a
 * recent password sign-in, otherwise behind the same re-proof panel the Reset flow uses.
 */

const signInMock = vi.fn()
vi.mock("@/components/AppFooter", () => ({ default: () => null }))
vi.mock("@/components/AppHeader", () => ({ default: () => null }))
vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
  signOut: vi.fn(),
}))

const LOCAL_USER = "local:7"
const ENTRA_USER = "entra-user-1"

let fetchMock: ReturnType<typeof vi.fn>
// Decides the response for each grant request body.
let grantFor: (body: Record<string, unknown>) => { ok: boolean; body: Record<string, unknown> }
let createCalls = 0

function grantBodies(): Record<string, unknown>[] {
  return fetchMock.mock.calls
    .filter((c) => c[0] === "/api/me/app-lock/reauth-grant")
    .map((c) => JSON.parse((c[1] as { body: string }).body))
}

beforeEach(() => {
  localStorage.clear()
  createCalls = 0
  signInMock.mockReset()
  grantFor = () => ({ ok: true, body: { granted: true } })
  fetchMock = vi.fn(async (url: string, init?: { body: string }) => {
    if (url === "/api/me/app-lock/reauth-grant") {
      const r = grantFor(JSON.parse(init?.body ?? "{}"))
      return { ok: r.ok, json: async () => r.body }
    }
    return { ok: true, json: async () => ({}) }
  })
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("PublicKeyCredential", class {})
  Object.defineProperty(navigator, "credentials", { configurable: true, value: {} })
  const adapter: WebAuthnAdapter = {
    async create() {
      createCalls++
      return { rawId: new TextEncoder().encode("new-credential").buffer as ArrayBuffer }
    },
    get: async () => ({ ok: true }),
  }
  __setWebAuthnAdapterForTests(adapter)
})

afterEach(() => {
  cleanup()
  __setWebAuthnAdapterForTests(null)
  vi.unstubAllGlobals()
  window.history.replaceState(null, "", "/")
})

const STALE = { ok: false, body: { error: "Enter your password to confirm it's you." } }

describe("AppLockOverlay first set-up grant", () => {
  it("fresh sign-in: sets up with no prompt, asking the server with recentSignIn", async () => {
    const onUnlocked = vi.fn()
    render(<AppLockOverlay userId={LOCAL_USER} onUnlocked={onUnlocked} onDisableAppLock={vi.fn()} />)

    fireEvent.click(await screen.findByRole("button", { name: "Set up App lock" }))

    await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1))
    expect(grantBodies()).toEqual([{ recentSignIn: true }])
    expect(screen.queryByLabelText("Current password")).toBeNull()
    expect(createCalls).toBe(1)
    expect(readBiometricCredentialId(localStorage, LOCAL_USER)).not.toBeNull()
  })

  it("stale sign-in: shows the panel, offers no set-up until the password is accepted", async () => {
    grantFor = (b) => (b.password === "secret123" ? { ok: true, body: { granted: true } } : STALE)
    const onUnlocked = vi.fn()
    render(<AppLockOverlay userId={LOCAL_USER} onUnlocked={onUnlocked} onDisableAppLock={vi.fn()} />)

    await screen.findByLabelText("Current password")
    expect(screen.getByText("Confirm it’s you to set up App lock.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Set up App lock" })).toBeNull()

    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "secret123" } })
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }))

    fireEvent.click(await screen.findByRole("button", { name: "Set up App lock" }))
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1))
    expect(grantBodies()[1]).toEqual({ password: "secret123", otp: "" })
  })

  it("wrong password stays locked with no set-up", async () => {
    grantFor = () => ({ ok: false, body: { error: "Invalid password" } })
    const onUnlocked = vi.fn()
    render(<AppLockOverlay userId={LOCAL_USER} onUnlocked={onUnlocked} onDisableAppLock={vi.fn()} />)

    await screen.findByLabelText("Current password")
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "wrong" } })
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }))

    await screen.findByText("Invalid password")
    expect(screen.queryByRole("button", { name: "Set up App lock" })).toBeNull()
    expect(onUnlocked).not.toHaveBeenCalled()
    expect(createCalls).toBe(0)
  })

  it("cancelling leaves the lock screen with a way back to the prompt and no set-up", async () => {
    grantFor = () => STALE
    render(<AppLockOverlay userId={LOCAL_USER} onUnlocked={vi.fn()} onDisableAppLock={vi.fn()} />)

    await screen.findByLabelText("Current password")
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

    expect(screen.queryByRole("button", { name: "Set up App lock" })).toBeNull()
    fireEvent.click(await screen.findByRole("button", { name: /Confirm it.s you to set up App lock/ }))
    expect(screen.getByLabelText("Current password")).toBeTruthy()
  })

  it("cleared storage with a live stale session cannot set up without the grant", async () => {
    grantFor = () => STALE
    const onUnlocked = vi.fn()
    render(<AppLockOverlay userId={LOCAL_USER} onUnlocked={onUnlocked} onDisableAppLock={vi.fn()} />)
    await screen.findByLabelText("Current password")
    expect(screen.queryByRole("button", { name: "Set up App lock" })).toBeNull()
    expect(createCalls).toBe(0)
    expect(onUnlocked).not.toHaveBeenCalled()
  })

  it("Entra: a fresh Microsoft sign-in is granted with the normal body and sets up", async () => {
    render(<AppLockOverlay userId={ENTRA_USER} onUnlocked={vi.fn()} onDisableAppLock={vi.fn()} />)
    await screen.findByRole("button", { name: "Set up App lock" })
    expect(grantBodies()).toEqual([{}])
  })

  it("Entra: refused grant forces a Microsoft sign-in tagged for set-up", async () => {
    grantFor = () => ({ ok: false, body: { error: "Sign in again with Microsoft to confirm it's you." } })
    render(<AppLockOverlay userId={ENTRA_USER} onUnlocked={vi.fn()} onDisableAppLock={vi.fn()} />)

    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Microsoft to confirm" }))

    const [provider, opts, authParams] = signInMock.mock.calls[0]
    expect(provider).toBe("microsoft-entra-id")
    expect((opts as { callbackUrl: string }).callbackUrl).toContain("appLockOptOut=setup")
    expect(authParams).toEqual({ prompt: "login", max_age: "0" })
    expect(screen.queryByRole("button", { name: "Set up App lock" })).toBeNull()
  })

  it("Entra: returning from the set-up sign-in with a grant offers set-up", async () => {
    window.history.replaceState(null, "", "/?appLockOptOut=setup")
    render(<AppLockOverlay userId={ENTRA_USER} onUnlocked={vi.fn()} onDisableAppLock={vi.fn()} />)
    await screen.findByRole("button", { name: "Set up App lock" })
    expect(grantBodies()).toHaveLength(1)
  })
})
