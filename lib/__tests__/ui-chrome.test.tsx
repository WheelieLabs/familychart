// @vitest-environment jsdom
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import Breadcrumb from "@/components/ui/Breadcrumb"
import LiveRegion from "@/components/ui/LiveRegion"
import PageContainer from "@/components/ui/PageContainer"
import { announce } from "@/lib/announce"

afterEach(cleanup)

describe("PageContainer", () => {
  it("is the single main landmark and the skip-link target", () => {
    render(<PageContainer>Content</PageContainer>)
    const main = screen.getByRole("main")
    expect(main.id).toBe("main-content")
    expect(main.getAttribute("tabindex")).toBe("-1")
  })

  it("sets the Canvas for the area", () => {
    const { rerender } = render(<PageContainer>x</PageContainer>)
    expect(screen.getByRole("main").className).toContain("fc-surface-app")
    rerender(<PageContainer area="admin">x</PageContainer>)
    expect(screen.getByRole("main").className).toContain("fc-surface-admin")
  })

  it("defaults to the page width and offers full and narrow", () => {
    const { container, rerender } = render(<PageContainer>x</PageContainer>)
    expect(container.querySelector(".fc-page")?.className).toBe("fc-page")
    rerender(<PageContainer width="full">x</PageContainer>)
    expect(container.querySelector(".fc-page")?.className).toContain("fc-page--full")
    rerender(<PageContainer width="narrow">x</PageContainer>)
    expect(container.querySelector(".fc-page")?.className).toContain("fc-page--narrow")
  })

  it("puts the header first, then the trail, then the content", () => {
    render(
      <PageContainer header={<p>Header</p>} trail={[{ label: "Management", href: "/management" }, { label: "People" }]}>
        <p>Body</p>
      </PageContainer>,
    )
    const content = screen.getByRole("main").firstElementChild!
    expect(content.children[0].textContent).toBe("Header")
    expect(content.children[1].getAttribute("aria-label")).toBe("Breadcrumb")
    expect(content.children[2].textContent).toBe("Body")
  })

  it("shows no trail when none is given", () => {
    render(<PageContainer>x</PageContainer>)
    expect(screen.queryByRole("navigation")).toBeNull()
  })
})

describe("Breadcrumb", () => {
  const trail = [
    { label: "Home", href: "/" },
    { label: "Alex", href: "/5" },
    { label: "History" },
  ]

  it("is a navigation landmark with an ordered list", () => {
    render(<Breadcrumb trail={trail} />)
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" })
    expect(nav.querySelector("ol")).toBeTruthy()
    expect(screen.getAllByRole("listitem")).toHaveLength(3)
  })

  it("links each level above the page, named by its visible text", () => {
    render(<Breadcrumb trail={trail} />)
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/")
    expect(screen.getByRole("link", { name: "Alex" }).getAttribute("href")).toBe("/5")
  })

  it("ends in the current page as plain text, not a link", () => {
    render(<Breadcrumb trail={trail} />)
    expect(screen.queryByRole("link", { name: "History" })).toBeNull()
    expect(screen.getByText("History").getAttribute("aria-current")).toBe("page")
  })

  it("marks only the nearest parent with a hidden chevron", () => {
    render(<Breadcrumb trail={trail} />)
    const chevrons = screen.getAllByText("‹")
    expect(chevrons).toHaveLength(1)
    expect(chevrons[0].getAttribute("aria-hidden")).toBe("true")
    expect(chevrons[0].closest("a")?.textContent).toContain("Alex")
  })

  it("runs an in-page step instead of following a link", () => {
    const onClick = vi.fn()
    render(<Breadcrumb trail={[{ label: "Alex", href: "/5" }, { label: "All values", onClick }, { label: "Hb" }]} />)
    fireEvent.click(screen.getByRole("button", { name: /All values/ }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it("renders nothing for an empty trail", () => {
    const { container } = render(<Breadcrumb trail={[]} />)
    expect(container.firstChild).toBeNull()
  })
})

describe("LiveRegion", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("has one polite status region and one assertive alert region", () => {
    render(<LiveRegion />)
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite")
    expect(screen.getByRole("alert").getAttribute("aria-live")).toBe("assertive")
  })

  it("speaks polite announcements in the status region", () => {
    render(<LiveRegion />)
    act(() => {
      announce("Saved: Weight 32.1 kg")
      vi.advanceTimersByTime(100)
    })
    expect(screen.getByRole("status").textContent).toBe("Saved: Weight 32.1 kg")
    expect(screen.getByRole("alert").textContent).toBe("")
  })

  it("speaks assertive announcements in the alert region", () => {
    render(<LiveRegion />)
    act(() => {
      announce("2 problems to fix. First: Name.", "assertive")
      vi.advanceTimersByTime(100)
    })
    expect(screen.getByRole("alert").textContent).toBe("2 problems to fix. First: Name.")
  })

  it("announces the same text twice by clearing in between", () => {
    render(<LiveRegion />)
    act(() => {
      announce("Saved")
      vi.advanceTimersByTime(100)
    })
    act(() => {
      announce("Saved")
    })
    expect(screen.getByRole("status").textContent).toBe("")
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(screen.getByRole("status").textContent).toBe("Saved")
  })
})
