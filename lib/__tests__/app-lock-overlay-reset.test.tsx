// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import AppLockOverlay from "@/components/AppLockOverlay"
import {
  __setWebAuthnAdapterForTests,
  readBiometricCredentialId,
  writeBiometricCredentialId,
  type WebAuthnAdapter,
} from "@/lib/webauthn-app-lock"

/**
 * Resetting and re-enrolling the App lock credential from the lock screen needs the same
 * server-verified grant as turning App lock off (ADR-0016). The grant endpoint itself is
 * covered in app-lock-api.test.ts; here the overlay is driven against a mocked fetch and the
 * WebAuthn adapter test hook.
 */

const signInMock = vi.fn()
vi.mock("@/components/AppFooter", () => ({ default: () => null }))
vi.mock("@/components/AppHeader", () => ({ default: () => null }))
vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
  signOut: vi.fn(),
}))

const OLD_ID = "b2xkLWNyZWRlbnRpYWw"
const LOCAL_USER = "local:7"
const ENTRA_USER = "entra-user-1"

let fetchMock: ReturnType<typeof vi.fn>
let grantResponse: { ok: boolean; body: Record<string, unknown> }
let createCalls = 0
let getImpl: () => Promise<{ ok: true } | null>

function install(): void {
  const adapter: WebAuthnAdapter = {
    async create() {
      createCalls++
      return { rawId: new TextEncoder().encode("new-credential").buffer as ArrayBuffer }
    },
    get: () => getImpl(),
  }
  __setWebAuthnAdapterForTests(adapter)
}

function grantCalls(): unknown[][] {
  return fetchMock.mock.calls.filter((c) => c[0] === "/api/me/app-lock/reauth-grant")
}

beforeEach(() => {
  localStorage.clear()
  createCalls = 0
  signInMock.mockReset()
  grantResponse = { ok: true, body: { granted: true } }
  fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/me/app-lock/reauth-grant") {
      return { ok: grantResponse.ok, json: async () => grantResponse.body }
    }
    return { ok: true, json: async () => ({}) }
  })
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("PublicKeyCredential", class {})
  Object.defineProperty(navigator, "credentials", { configurable: true, value: {} })
  // A device whose get() always fails, then succeeds once a new credential is verified.
  getImpl = async () => {
    throw new DOMException("denied", "NotAllowedError")
  }
  install()
  writeBiometricCredentialId(localStorage, LOCAL_USER, OLD_ID)
  writeBiometricCredentialId(localStorage, ENTRA_USER, OLD_ID)
})

afterEach(() => {
  cleanup()
  __setWebAuthnAdapterForTests(null)
  vi.unstubAllGlobals()
  window.history.replaceState(null, "", "/")
})

async function renderFailedUnlock(userId: string, onUnlocked = vi.fn()) {
  render(<AppLockOverlay userId={userId} onUnlocked={onUnlocked} onDisableAppLock={vi.fn()} />)
  // jsdom has no focus, so the overlay's auto-unlock waits; tap the button instead.
  fireEvent.click(await screen.findByRole("button", { name: "Unlock with your device" }))
  await screen.findByRole("button", { name: /Reset and set up again/ })
  return onUnlocked
}

describe("AppLockOverlay reset needs re-proof", () => {
  it("does not clear the stored credential or offer set-up until a grant is obtained", async () => {
    const onUnlocked = await renderFailedUnlock(LOCAL_USER)

    fireEvent.click(screen.getByRole("button", { name: /Reset and set up again/ }))

    expect(readBiometricCredentialId(localStorage, LOCAL_USER)).toBe(OLD_ID)
    expect(screen.queryByRole("button", { name: "Set up App lock" })).toBeNull()
    expect(screen.getByLabelText("Current password")).toBeTruthy()
    expect(createCalls).toBe(0)
    expect(onUnlocked).not.toHaveBeenCalled()
    expect(grantCalls()).toHaveLength(0)
  })

  it("keeps the credential and stays locked when the server refuses the password", async () => {
    grantResponse = { ok: false, body: { error: "Invalid password" } }
    const onUnlocked = await renderFailedUnlock(LOCAL_USER)

    fireEvent.click(screen.getByRole("button", { name: /Reset and set up again/ }))
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "wrong" } })
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }))

    await screen.findByText("Invalid password")
    expect(readBiometricCredentialId(localStorage, LOCAL_USER)).toBe(OLD_ID)
    expect(screen.queryByRole("button", { name: "Set up App lock" })).toBeNull()
    expect(onUnlocked).not.toHaveBeenCalled()
  })

  it("explains why a password is needed", async () => {
    await renderFailedUnlock(LOCAL_USER)
    fireEvent.click(screen.getByRole("button", { name: /Reset and set up again/ }))
    expect(screen.getByText(/we need your password first/)).toBeTruthy()
  })

  it("cancelling the re-proof leaves the credential in place", async () => {
    await renderFailedUnlock(LOCAL_USER)
    fireEvent.click(screen.getByRole("button", { name: /Reset and set up again/ }))
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(readBiometricCredentialId(localStorage, LOCAL_USER)).toBe(OLD_ID)
    expect(screen.queryByLabelText("Current password")).toBeNull()
  })

  it("with a valid grant, reset then set-up writes the new credential and unlocks", async () => {
    const onUnlocked = await renderFailedUnlock(LOCAL_USER)

    fireEvent.click(screen.getByRole("button", { name: /Reset and set up again/ }))
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "secret123" } })
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }))

    const setup = await screen.findByRole("button", { name: "Set up App lock" })
    expect(grantCalls()).toHaveLength(1)
    expect(JSON.parse((grantCalls()[0][1] as { body: string }).body)).toEqual({
      password: "secret123",
      otp: "",
    })
    expect(readBiometricCredentialId(localStorage, LOCAL_USER)).toBeNull()
    expect(onUnlocked).not.toHaveBeenCalled()

    getImpl = async () => ({ ok: true })
    fireEvent.click(setup)

    await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1))
    expect(createCalls).toBe(1)
    const stored = readBiometricCredentialId(localStorage, LOCAL_USER)
    expect(stored).not.toBeNull()
    expect(stored).not.toBe(OLD_ID)
  })

  it("asks for the authenticator code when the server requires one", async () => {
    grantResponse = { ok: false, body: { error: "Authenticator code is required" } }
    await renderFailedUnlock(LOCAL_USER)
    fireEvent.click(screen.getByRole("button", { name: /Reset and set up again/ }))
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "secret123" } })
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }))
    await screen.findByLabelText(/Authenticator code/)
    expect(readBiometricCredentialId(localStorage, LOCAL_USER)).toBe(OLD_ID)
  })

  it("Entra: starts a fresh Microsoft sign-in tagged for reset, without clearing anything", async () => {
    await renderFailedUnlock(ENTRA_USER)
    fireEvent.click(screen.getByRole("button", { name: /Reset and set up again/ }))
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Microsoft to confirm" }))

    expect(signInMock).toHaveBeenCalledTimes(1)
    const [provider, opts, authParams] = signInMock.mock.calls[0]
    expect(provider).toBe("microsoft-entra-id")
    expect((opts as { callbackUrl: string }).callbackUrl).toContain("appLockOptOut=reset")
    expect(authParams).toEqual({ prompt: "login", max_age: "0" })
    expect(readBiometricCredentialId(localStorage, ENTRA_USER)).toBe(OLD_ID)
  })

  it("Entra: returning from the sign-in with a grant resets and offers set-up", async () => {
    window.history.replaceState(null, "", "/?appLockOptOut=reset")
    const onDisable = vi.fn()
    render(<AppLockOverlay userId={ENTRA_USER} onUnlocked={vi.fn()} onDisableAppLock={onDisable} />)

    await screen.findByRole("button", { name: "Set up App lock" })
    expect(grantCalls()).toHaveLength(1)
    expect(readBiometricCredentialId(localStorage, ENTRA_USER)).toBeNull()
    expect(onDisable).not.toHaveBeenCalled()
    expect(window.location.search).toBe("")
  })

  it("Entra: returning without a fresh sign-in keeps the credential and shows the refusal", async () => {
    grantResponse = { ok: false, body: { error: "Sign in again with Microsoft to confirm it's you." } }
    window.history.replaceState(null, "", "/?appLockOptOut=reset")
    render(<AppLockOverlay userId={ENTRA_USER} onUnlocked={vi.fn()} onDisableAppLock={vi.fn()} />)

    await screen.findByText(/Sign in again with Microsoft/)
    expect(readBiometricCredentialId(localStorage, ENTRA_USER)).toBe(OLD_ID)
    expect(screen.queryByRole("button", { name: "Set up App lock" })).toBeNull()
  })

  it("Entra: the turn-off return still disables App lock, not reset", async () => {
    window.history.replaceState(null, "", "/?appLockOptOut=1")
    const onDisable = vi.fn()
    render(<AppLockOverlay userId={ENTRA_USER} onUnlocked={vi.fn()} onDisableAppLock={onDisable} />)
    await waitFor(() => expect(onDisable).toHaveBeenCalledTimes(1))
    expect(readBiometricCredentialId(localStorage, ENTRA_USER)).toBe(OLD_ID)
  })
})
