// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import Badge from "@/components/ui/Badge"
import EntityRowActions from "@/components/ui/EntityRowActions"
import ListCard, { CardList } from "@/components/ui/ListCard"
import { Toggle } from "@/components/ui/controls"

afterEach(cleanup)

describe("ListCard", () => {
  it("is a list item on a dark Card", () => {
    render(<CardList><ListCard title="Paracetamol" /></CardList>)
    const item = screen.getByRole("listitem")
    expect(item.hasAttribute("data-card")).toBe(true)
    expect(item.getAttribute("data-surface")).toBe("dark")
    expect(screen.getByRole("list")).toBeTruthy()
  })

  it("lets an email title wrap after @ and . and keeps its text whole", () => {
    const { container } = render(<ListCard title="admin2@example.test" />)
    expect(container.querySelector(".fc-card__title")?.textContent).toBe("admin2@example.test")
    expect(container.querySelectorAll(".fc-card__title wbr").length).toBe(2)
  })

  it("leaves a title with spaces alone", () => {
    const { container } = render(<ListCard title="Dr. Smith" />)
    expect(container.querySelectorAll(".fc-card__title wbr").length).toBe(0)
  })

  it("joins the meta parts with a middle dot, in the order given, and drops empty ones", () => {
    render(<ListCard title="Paracetamol" meta={["7:46 pm", "250 mg", null, "Fever", false, ""]} />)
    expect(screen.getByText("7:46 pm · 250 mg · Fever")).toBeTruthy()
  })

  it("puts free text last, in italics", () => {
    render(<ListCard title="Paracetamol" meta={["7:46 pm", "250 mg"]} note="with food" />)
    const meta = screen.getByText(/7:46 pm · 250 mg/)
    const note = within(meta).getByText("with food")
    expect(note.tagName).toBe("EM")
    expect(meta.textContent).toBe("7:46 pm · 250 mg · with food")
  })

  it("shows the note alone without a leading separator", () => {
    render(<ListCard title="Alex" note="likes dinosaurs" />)
    expect(screen.getByText("likes dinosaurs").parentElement?.textContent).toBe("likes dinosaurs")
  })

  it("keeps the whole title as text, with no truncation class", () => {
    const long = "A very long medication name that would not fit on one line of a narrow phone screen"
    render(<ListCard title={long} />)
    expect(screen.getByText(long).className).not.toMatch(/truncate|ellipsis|line-clamp/)
  })

  it("makes the title a link whose accessible name is its visible text", () => {
    render(<ListCard title="Alex" href="/5" />)
    const link = screen.getByRole("link", { name: "Alex" })
    expect(link.getAttribute("href")).toBe("/5")
    expect(link.hasAttribute("aria-label")).toBe(false)
  })

  it("hides the icon and the avatar from screen readers", () => {
    render(<ListCard title="Alex" icon="💊" avatar={{ name: "Alex Smith" }} />)
    expect(screen.getByText("💊").getAttribute("aria-hidden")).toBe("true")
    expect(screen.getByText("AS").getAttribute("aria-hidden")).toBe("true")
  })

  it("uses a photo for the avatar when there is one", () => {
    const { container } = render(<ListCard title="Alex" avatar={{ name: "Alex", src: "/photo.jpg" }} />)
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("")
  })

  it("shows links and badges on an extras line", () => {
    render(<ListCard title="Fever" extras={<Badge tone="warning">Moderate</Badge>} />)
    expect(screen.getByText("Moderate").className).toContain("fc-badge--warning")
  })

  it("holds the row actions at the end, named after the row", () => {
    const onEdit = vi.fn()
    render(<ListCard title="Paracetamol" trailing={<EntityRowActions name="Paracetamol" onEdit={onEdit} onDelete={() => {}} />} />)
    fireEvent.click(screen.getByRole("button", { name: "Edit Paracetamol" }))
    expect(onEdit).toHaveBeenCalledOnce()
    expect(screen.getByRole("button", { name: "Delete Paracetamol" })).toBeTruthy()
  })

  it("holds a named Active switch in the trailing slot", () => {
    const onChange = vi.fn()
    render(<ListCard title="Weight" inactive trailing={<Toggle label="Active" checked={false} onChange={onChange} />} />)
    fireEvent.click(screen.getByRole("switch", { name: "Active" }))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it("dims an inactive row through its own class", () => {
    render(<ListCard title="Weight" inactive />)
    expect(screen.getByRole("listitem").className).toContain("fc-card--inactive")
  })
})
