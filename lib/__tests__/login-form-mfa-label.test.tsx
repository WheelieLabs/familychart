// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import LoginForm from "@/app/login/LoginForm"

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }))

afterEach(cleanup)

describe("LoginForm authenticator code label", () => {
  it("keeps the code field optional when MFA is not enforced", () => {
    render(<LoginForm enableEntra={false} enableCredentials />)
    expect(screen.getByText("(optional)")).toBeTruthy()
  })

  it("drops the optional marker when the instance enforces MFA", () => {
    render(<LoginForm enableEntra={false} enableCredentials mfaRequired />)
    expect(screen.queryByText("(optional)")).toBeNull()
    expect(screen.getByLabelText("Authenticator code")).toBeTruthy()
  })
})
