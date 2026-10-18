// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { Toggle } from "@/components/ui/controls"

afterEach(cleanup)

function described(el: HTMLElement): string[] {
  return (el.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map(id => document.getElementById(id)?.textContent ?? "")
}

describe("Toggle", () => {
  it("is a named switch", () => {
    render(<Toggle label="Sign-in enabled" checked onChange={() => {}} />)
    expect(screen.getByRole("switch", { name: "Sign-in enabled" }).getAttribute("aria-checked")).toBe("true")
  })

  it("ties its hint to the switch", () => {
    render(<Toggle label="Sign-in enabled" hint="Turning this off blocks sign-in immediately." checked onChange={() => {}} />)
    const sw = screen.getByRole("switch")
    expect(described(sw)).toEqual(["Turning this off blocks sign-in immediately."])
  })

  it("keeps the hint when disabled and also explains why", () => {
    render(<Toggle label="Reports" hint="Helper." checked={false} disabled disabledReason="Needs a role." onChange={() => {}} />)
    expect(described(screen.getByRole("switch"))).toEqual(["Helper.", "Needs a role."])
  })

  it("has no description when there is neither", () => {
    render(<Toggle label="Reports" checked={false} onChange={() => {}} />)
    expect(screen.getByRole("switch").getAttribute("aria-describedby")).toBeNull()
  })
})
