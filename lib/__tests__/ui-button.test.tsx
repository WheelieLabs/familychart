// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import Button from "@/components/ui/Button"
import EntityRowActions from "@/components/ui/EntityRowActions"
import IconButton from "@/components/ui/IconButton"
import { subscribeToAnnouncements } from "@/lib/announce"

afterEach(cleanup)

describe("Button", () => {
  it("defaults to a primary Default button that does not submit", () => {
    render(<Button>Save</Button>)
    const button = screen.getByRole("button", { name: "Save" })
    expect(button).toHaveProperty("type", "button")
    expect(button.className).toContain("fc-btn--primary")
    expect(button.className).not.toContain("fc-btn--compact")
  })

  it.each(["primary", "secondary", "destructive", "quiet"] as const)("renders the %s variant", variant => {
    render(<Button variant={variant}>Go</Button>)
    expect(screen.getByRole("button", { name: "Go" }).className).toContain(`fc-btn--${variant}`)
  })

  it("renders the Compact size and full width", () => {
    render(<Button size="compact" fullWidth>Refresh</Button>)
    const button = screen.getByRole("button", { name: "Refresh" })
    expect(button.className).toContain("fc-btn--compact")
    expect(button.className).toContain("fc-btn--full")
  })

  it("renders a link with the same look when given an href", () => {
    render(<Button href="/somewhere">Go Home</Button>)
    const link = screen.getByRole("link", { name: "Go Home" })
    expect(link.getAttribute("href")).toBe("/somewhere")
    expect(link.className).toContain("fc-btn--primary")
  })

  it("calls onClick", () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  describe("disabled", () => {
    it("shows the reason as text tied to the button", () => {
      render(<Button disabled disabledReason="Email is not configured.">Send invite</Button>)
      const button = screen.getByRole("button", { name: "Send invite" })
      expect(button).toHaveProperty("disabled", true)
      expect(screen.getByText("Email is not configured.")).toBeTruthy()
      const describedBy = button.getAttribute("aria-describedby")!
      expect(document.getElementById(describedBy)?.textContent).toBe("Email is not configured.")
    })

    it("refuses a disabled button with no reason", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {})
      // @ts-expect-error the type refuses `disabled` without `disabledReason`
      expect(() => render(<Button disabled>Send</Button>)).toThrow(/disabledReason/)
      error.mockRestore()
    })
  })

  describe("pending", () => {
    it("shows Saving…, ignores further clicks and is marked busy", () => {
      const onClick = vi.fn()
      render(<Button pending onClick={onClick}>Save</Button>)
      const button = screen.getByRole("button", { name: "Saving…" })
      expect(button.getAttribute("aria-busy")).toBe("true")
      fireEvent.click(button)
      expect(onClick).not.toHaveBeenCalled()
    })

    it("announces Saving… through the live region", () => {
      const messages: string[] = []
      const unsubscribe = subscribeToAnnouncements(m => messages.push(m))
      render(<Button pending>Save</Button>)
      unsubscribe()
      expect(messages).toEqual(["Saving…"])
    })

    it("keeps the original label in the layout so the width holds, hidden from screen readers", () => {
      const { container } = render(<Button pending>Save record</Button>)
      const hidden = container.querySelector('[data-hidden="true"]')
      expect(hidden?.textContent).toBe("Save record")
      expect(hidden?.getAttribute("aria-hidden")).toBe("true")
    })
  })

  describe("destructive on the canvas", () => {
    it("reports a destructive button directly on the canvas", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {})
      render(<div className="fc-surface-app"><Button variant="destructive">Delete</Button></div>)
      expect(error).toHaveBeenCalledWith(expect.stringContaining("confirm modal"))
      error.mockRestore()
    })

    it("accepts one on a Card or a light surface", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {})
      render(
        <div className="fc-surface-app">
          <div data-surface="dark" data-card><Button variant="destructive">Delete</Button></div>
          <div data-surface="light"><Button variant="destructive">Remove</Button></div>
        </div>,
      )
      expect(error).not.toHaveBeenCalled()
      error.mockRestore()
    })
  })
})

describe("IconButton", () => {
  it("is named by its label, with the icon hidden", () => {
    render(<IconButton label="Menu">☰</IconButton>)
    const button = screen.getByRole("button", { name: "Menu" })
    expect(button.querySelector('[aria-hidden="true"]')?.textContent).toBe("☰")
  })

  it("refuses an empty label", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => render(<IconButton label="  ">☰</IconButton>)).toThrow(/label/)
    error.mockRestore()
  })

  it("renders a named link when given an href", () => {
    render(<IconButton label="Home" href="/">⌂</IconButton>)
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/")
  })
})

describe("EntityRowActions", () => {
  it("names each button after its row and calls the handlers", () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    render(<EntityRowActions name="Paracetamol" onEdit={onEdit} onDelete={onDelete} />)
    fireEvent.click(screen.getByRole("button", { name: "Edit Paracetamol" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete Paracetamol" }))
    expect(onEdit).toHaveBeenCalledOnce()
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it("shows only the actions it is given", () => {
    render(<EntityRowActions name="Alex" onEdit={() => {}} />)
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull()
  })
})
