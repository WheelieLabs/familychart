import { describe, expect, it } from "vitest"
import {
  administrationTrail,
  diagnosticsTrail,
  managementTrail,
  personHubTrail,
  personTrail,
} from "@/lib/ui/breadcrumbs"

describe("trails", () => {
  it("puts the person hub under Home, ending in the person's name", () => {
    expect(personHubTrail("Alex Smith")).toEqual([{ label: "Home", href: "/" }, { label: "Alex Smith" }])
  })

  it("puts a person's page under the hub, labelled with their name", () => {
    expect(personTrail(7, "Alex Smith", { label: "History" })).toEqual([
      { label: "Alex Smith", href: "/7" },
      { label: "History" },
    ])
  })

  it("keeps deeper steps after the page, in order", () => {
    const onClick = () => {}
    expect(personTrail("7", "Alex", { label: "Test results", onClick }, { label: "General Chemistry" })).toEqual([
      { label: "Alex", href: "/7" },
      { label: "Test results", onClick },
      { label: "General Chemistry" },
    ])
  })

  it("falls back to a neutral label until the person's name has loaded", () => {
    expect(personTrail(7, "  ", { label: "History" })[0]).toEqual({ label: "Person", href: "/7" })
  })

  it("puts management, administration and diagnostics pages under their hub", () => {
    expect(managementTrail({ label: "People" })).toEqual([{ label: "Management", href: "/management" }, { label: "People" }])
    expect(administrationTrail({ label: "Accounts" })).toEqual([
      { label: "Administration", href: "/admin/overview" },
      { label: "Accounts" },
    ])
    expect(diagnosticsTrail({ label: "App Lock" })).toEqual([{ label: "Diagnostics", href: "/diagnostics" }, { label: "App Lock" }])
  })
})
