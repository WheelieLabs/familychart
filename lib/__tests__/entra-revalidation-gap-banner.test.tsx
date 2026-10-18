// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import EntraRevalidationGapBanner from "@/components/EntraRevalidationGapBanner"

afterEach(cleanup)

describe("EntraRevalidationGapBanner", () => {
  it("counts the users with no group data, naming the exposure and both fixes", () => {
    const { container } = render(
      <EntraRevalidationGapBanner gap={{ graphConfigured: true, usersWithoutGroupData: 3 }} variant="full" />,
    )
    expect(container.querySelector(".fc-banner--warning")).toBeTruthy()
    const text = container.textContent ?? ""
    expect(text).toContain("3 Entra users have no group data")
    expect(text).toContain("until you revoke them or they unsubscribe")
    expect(text).toContain("User.Read.All")
    expect(text).toContain("GroupMember.Read.All")
    expect(text).toContain("Revoke")
  })

  it("uses the singular for one user", () => {
    render(<EntraRevalidationGapBanner gap={{ graphConfigured: true, usersWithoutGroupData: 1 }} variant="full" />)
    expect(screen.getByText("1 Entra user has no group data", { exact: false })).toBeTruthy()
  })

  it("says Graph is not configured when it is, without a count", () => {
    const { container } = render(
      <EntraRevalidationGapBanner gap={{ graphConfigured: false, usersWithoutGroupData: 0 }} variant="full" />,
    )
    const text = container.textContent ?? ""
    expect(text).toContain("Microsoft Graph isn't configured")
    expect(text).not.toContain("have no group data")
  })

  it("is shorter on the Administration overview and links to Entra Sessions", () => {
    const full = render(
      <EntraRevalidationGapBanner gap={{ graphConfigured: true, usersWithoutGroupData: 3 }} variant="full" />,
    ).container.textContent ?? ""
    cleanup()
    const { container } = render(
      <EntraRevalidationGapBanner gap={{ graphConfigured: true, usersWithoutGroupData: 3 }} variant="compact" />,
    )
    expect((container.textContent ?? "").length).toBeLessThan(full.length)
    expect(screen.getByRole("link", { name: "Entra Sessions" }).getAttribute("href")).toBe("/admin/entra-sessions")
  })

  it("adds a line that email alerts are off when outbound email is not configured", () => {
    const { container } = render(
      <EntraRevalidationGapBanner
        gap={{ graphConfigured: false, usersWithoutGroupData: 0 }}
        variant="full"
        emailAlertsOff
      />,
    )
    expect(container.textContent).toContain("Email alerts are off because outbound email is not configured.")
  })

  it("leaves the email-alerts line out when email is configured, and on the overview", () => {
    const gap = { graphConfigured: false, usersWithoutGroupData: 0 }
    const configured = render(<EntraRevalidationGapBanner gap={gap} variant="full" />).container.textContent ?? ""
    expect(configured).not.toContain("Email alerts are off")
    cleanup()
    const overview = render(<EntraRevalidationGapBanner gap={gap} variant="compact" emailAlertsOff />).container.textContent ?? ""
    expect(overview).not.toContain("Email alerts are off")
  })
})
