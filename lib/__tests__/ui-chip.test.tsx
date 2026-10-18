// @vitest-environment jsdom
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import Chip, { ChipGroup } from "@/components/ui/Chip"
import FormField from "@/components/ui/FormField"
import SeveritySlider from "@/components/ui/SeveritySlider"

afterEach(cleanup)

const KINDS = [
  { value: "all", label: "All" },
  { value: "doses", label: "Doses" },
  { value: "symptoms", label: "Symptoms" },
] as const

function Group({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState<string>("all")
  return (
    <ChipGroup
      legend="Show"
      options={KINDS}
      value={value}
      onChange={v => { setValue(v); onChange?.(v) }}
    />
  )
}

describe("Choice chips", () => {
  it("are radios in a radiogroup labelled by the fieldset legend", () => {
    render(<Group />)
    const group = screen.getByRole("radiogroup", { name: "Show" })
    expect(group).toBeTruthy()
    expect(screen.getAllByRole("radio")).toHaveLength(3)
    expect(screen.getByRole("group", { name: "Show" }).tagName).toBe("FIELDSET")
  })

  it("mark the selected chip with aria-checked and a tick", () => {
    render(<Group />)
    expect(screen.getByRole("radio", { name: "All" }).getAttribute("aria-checked")).toBe("true")
    expect(screen.getByRole("radio", { name: "Doses" }).getAttribute("aria-checked")).toBe("false")
    expect(screen.getByRole("radio", { name: "All" }).textContent).toContain("✓")
    expect(screen.getByRole("radio", { name: "Doses" }).textContent).not.toContain("✓")
  })

  it("keep only the selected chip in the tab order", () => {
    render(<Group />)
    expect(screen.getByRole("radio", { name: "All" }).tabIndex).toBe(0)
    expect(screen.getByRole("radio", { name: "Doses" }).tabIndex).toBe(-1)
  })

  it("select on click", () => {
    const onChange = vi.fn()
    render(<Group onChange={onChange} />)
    fireEvent.click(screen.getByRole("radio", { name: "Symptoms" }))
    expect(onChange).toHaveBeenCalledWith("symptoms")
  })

  it("move with the arrow keys, wrapping at the ends, and move focus with them", () => {
    render(<Group />)
    const group = screen.getByRole("radiogroup")
    fireEvent.keyDown(group, { key: "ArrowRight" })
    expect(screen.getByRole("radio", { name: "Doses" }).getAttribute("aria-checked")).toBe("true")
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Doses" }))
    fireEvent.keyDown(group, { key: "ArrowLeft" })
    fireEvent.keyDown(group, { key: "ArrowLeft" })
    expect(screen.getByRole("radio", { name: "Symptoms" }).getAttribute("aria-checked")).toBe("true")
    fireEvent.keyDown(group, { key: "Home" })
    expect(screen.getByRole("radio", { name: "All" }).getAttribute("aria-checked")).toBe("true")
    fireEvent.keyDown(group, { key: "End" })
    expect(screen.getByRole("radio", { name: "Symptoms" }).getAttribute("aria-checked")).toBe("true")
  })

  it("can keep the legend for screen readers only", () => {
    render(<ChipGroup legend="Show" hideLegend options={KINDS} value="all" onChange={() => {}} />)
    expect(screen.getByText("Show").className).toContain("fc-visually-hidden")
    expect(screen.getByRole("radiogroup", { name: "Show" })).toBeTruthy()
  })
})

describe("Toggle chips", () => {
  it("expose aria-pressed and show a tick when pressed", () => {
    const onPressedChange = vi.fn()
    const { rerender } = render(<Chip kind="toggle" pressed={false} onPressedChange={onPressedChange}>Haemoglobin</Chip>)
    const chip = screen.getByRole("button", { name: "Haemoglobin" })
    expect(chip.getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(chip)
    expect(onPressedChange).toHaveBeenCalledWith(true)
    rerender(<Chip kind="toggle" pressed onPressedChange={onPressedChange}>Haemoglobin</Chip>)
    expect(screen.getByRole("button", { name: /Haemoglobin/ }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: /Haemoglobin/ }).textContent).toContain("✓")
  })
})

describe("Disclosure chips", () => {
  it("expose aria-expanded and swap the chevron", () => {
    const onExpandedChange = vi.fn()
    const { rerender } = render(<Chip kind="disclosure" expanded={false} emoji="🤒" onExpandedChange={onExpandedChange}>For symptom</Chip>)
    const chip = screen.getByRole("button", { name: "For symptom" })
    expect(chip.getAttribute("aria-expanded")).toBe("false")
    expect(chip.textContent).toContain("▾")
    fireEvent.click(chip)
    expect(onExpandedChange).toHaveBeenCalledWith(true)
    rerender(<Chip kind="disclosure" expanded emoji="🤒" onExpandedChange={onExpandedChange}>For symptom</Chip>)
    expect(screen.getByRole("button", { name: "For symptom" }).getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByRole("button", { name: "For symptom" }).textContent).toContain("▴")
  })

  it("hide the emoji and chevron from the accessible name", () => {
    render(<Chip kind="disclosure" expanded={false} emoji="💊" onExpandedChange={() => {}}>For dose</Chip>)
    expect(screen.getByRole("button", { name: "For dose" })).toBeTruthy()
  })
})

describe("SeveritySlider", () => {
  it("is a range from 1 to 5 named by its field, with a value text", () => {
    render(<FormField label="Severity"><SeveritySlider value={1} onChange={() => {}} /></FormField>)
    const slider = screen.getByRole("slider", { name: "Severity" })
    expect(slider.getAttribute("min")).toBe("1")
    expect(slider.getAttribute("max")).toBe("5")
    expect(slider.getAttribute("step")).toBe("1")
    expect(slider.getAttribute("aria-valuetext")).toBe("1 of 5")
  })

  it("shows the value as n of 5, the numbers and the three words", () => {
    render(<SeveritySlider value={3} onChange={() => {}} />)
    expect(screen.getByText("3 of 5")).toBeTruthy()
    for (const text of ["1", "2", "4", "5", "Mild", "Moderate", "Severe"]) {
      expect(screen.getByText(text)).toBeTruthy()
    }
  })

  it("reports a number when moved", () => {
    const onChange = vi.fn()
    render(<SeveritySlider value={1} onChange={onChange} />)
    fireEvent.change(screen.getByRole("slider"), { target: { value: "4" } })
    expect(onChange).toHaveBeenCalledWith(4)
  })
})
