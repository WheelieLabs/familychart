// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import Banner, { type BannerKind } from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import EmptyState, { EMPTY_STATE_ICONS } from "@/components/ui/EmptyState"
import { subscribeToAnnouncements } from "@/lib/announce"

afterEach(cleanup)

describe("EmptyState", () => {
  it("has an h2 heading, copy, and an icon hidden from screen readers", () => {
    render(<EmptyState icon={EMPTY_STATE_ICONS.noMedications} heading="No medications yet">Add one to start recording doses.</EmptyState>)
    expect(screen.getByRole("heading", { level: 2, name: "No medications yet" })).toBeTruthy()
    expect(screen.getByText("Add one to start recording doses.")).toBeTruthy()
    expect(screen.getByText("💊").getAttribute("aria-hidden")).toBe("true")
  })

  it("shows the action only when one is given", () => {
    const { rerender } = render(<EmptyState icon="💊" heading="No medications yet">Add one.</EmptyState>)
    expect(screen.queryByRole("link")).toBeNull()
    rerender(
      <EmptyState icon="🔒" heading="Access denied" action={<Button href="/">Go Home</Button>}>You don&apos;t have permission.</EmptyState>,
    )
    expect(screen.getByRole("link", { name: "Go Home" })).toBeTruthy()
  })

  it("gives each situation exactly one icon", () => {
    const icons = Object.values(EMPTY_STATE_ICONS)
    expect(new Set(icons).size).toBe(icons.length)
  })
})

describe("Banner", () => {
  const cases: [BannerKind, string, string][] = [
    ["info", "ℹ️", "Note"],
    ["warning", "⚠️", "Warning"],
    ["error", "⛔", "Error"],
    ["success", "✅", "Success"],
  ]

  it.each(cases)("renders the %s kind with an icon and a bold lead word", (kind, icon, lead) => {
    const { container } = render(<Banner kind={kind}>Something happened.</Banner>)
    expect(container.querySelector(`.fc-banner--${kind}`)).toBeTruthy()
    expect(screen.getByText(icon).getAttribute("aria-hidden")).toBe("true")
    expect(screen.getByText(`${lead}:`)).toBeTruthy()
    expect(screen.getByText("Something happened.", { exact: false })).toBeTruthy()
  })

  it("accepts its own lead word", () => {
    render(<Banner kind="success" lead="Saved">Weight 32.1 kg</Banner>)
    expect(screen.getByText("Saved:")).toBeTruthy()
  })

  it("is plain content when present at load, and an alert only for errors", () => {
    const messages: string[] = []
    const unsubscribe = subscribeToAnnouncements(m => messages.push(m))
    render(<Banner kind="warning">Email is not configured.</Banner>)
    render(<Banner kind="error">Email or password is incorrect.</Banner>)
    unsubscribe()
    expect(messages).toEqual([])
    expect(screen.getAllByRole("alert")).toHaveLength(1)
    expect(screen.getByRole("alert").textContent).toContain("Email or password is incorrect.")
  })

  it("announces politely when it appears after an action", () => {
    const messages: [string, string][] = []
    const unsubscribe = subscribeToAnnouncements((m, p) => messages.push([m, p]))
    render(<Banner kind="success" lead="Saved" announced>Weight 32.1 kg</Banner>)
    unsubscribe()
    expect(messages).toEqual([["Saved: Weight 32.1 kg", "polite"]])
  })

  it("does not announce an error twice: role=alert already does", () => {
    const messages: string[] = []
    const unsubscribe = subscribeToAnnouncements(m => messages.push(m))
    render(<Banner kind="error" announced>Could not save.</Banner>)
    unsubscribe()
    expect(messages).toEqual([])
  })

  it("can be dismissed", () => {
    const onDismiss = vi.fn()
    render(<Banner kind="success" onDismiss={onDismiss}>Saved.</Banner>)
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it("declares a light surface for the buttons inside it", () => {
    const { container } = render(<Banner kind="info">Note.</Banner>)
    expect(container.querySelector(".fc-banner")?.getAttribute("data-surface")).toBe("light")
  })
})
