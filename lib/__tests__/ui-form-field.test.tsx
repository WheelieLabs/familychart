// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import DateEcho from "@/components/ui/DateEcho"
import FormField, { FieldGroup, FieldRow } from "@/components/ui/FormField"
import { Checkbox, FileInput, Input, Select, Textarea, Toggle } from "@/components/ui/controls"
import { announce, subscribeToAnnouncements } from "@/lib/announce"
import { describeProblems, focusFirstInvalid } from "@/lib/ui/form-errors"

afterEach(cleanup)

describe("FormField", () => {
  it("labels the control through the field", () => {
    render(<FormField label="Name"><Input /></FormField>)
    expect(screen.getByRole("textbox", { name: "Name" })).toBeTruthy()
  })

  it.each([
    ["input", <Input key="i" />],
    ["select", <Select key="s"><option>A</option></Select>],
    ["textarea", <Textarea key="t" />],
  ])("labels a %s", (_name, control) => {
    render(<FormField label="Field">{control}</FormField>)
    expect(screen.getByLabelText("Field")).toBeTruthy()
  })

  it("marks an optional field without changing its name", () => {
    render(<FormField label="Notes" optional><Textarea /></FormField>)
    expect(screen.getByText("(optional)")).toBeTruthy()
    expect(screen.getByRole("textbox", { name: /^Notes/ })).toBeTruthy()
  })

  it("describes the control with its hint and its error, and marks it invalid", () => {
    render(
      <FormField label="Password" hint="At least 10 characters." error="Too short.">
        <Input type="password" />
      </FormField>,
    )
    const input = screen.getByLabelText(/Password/)
    expect(input.getAttribute("aria-invalid")).toBe("true")
    const describedBy = input.getAttribute("aria-describedby")!.split(" ")
    expect(describedBy.map(id => document.getElementById(id)?.textContent)).toEqual([
      "At least 10 characters.",
      "⚠ Too short.",
    ])
  })

  it("hides the warning mark from screen readers but keeps it on screen", () => {
    render(<FormField label="Name" error="Required."><Input /></FormField>)
    expect(screen.getByText("⚠").getAttribute("aria-hidden")).toBe("true")
  })

  it("is not invalid and has no description without a hint or error", () => {
    render(<FormField label="Name"><Input /></FormField>)
    const input = screen.getByRole("textbox")
    expect(input.getAttribute("aria-invalid")).toBeNull()
    expect(input.getAttribute("aria-describedby")).toBeNull()
  })

  it("names a unit selector separately in a compound control", () => {
    render(
      <FormField label="Dosage">
        <FieldRow>
          <Input type="number" />
          <Select aria-label="Unit"><option>mg</option></Select>
        </FieldRow>
      </FormField>,
    )
    expect(screen.getByRole("spinbutton", { name: "Dosage" })).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "Unit" })).toBeTruthy()
  })

  it("lays out an inline field for the Date and Time rows", () => {
    const { container } = render(<FormField label="Date" layout="inline"><Input type="date" /></FormField>)
    expect(container.querySelector(".fc-field--inline")).toBeTruthy()
  })
})

describe("FieldGroup", () => {
  it("is a fieldset whose legend names the group and whose error describes it (aria-invalid is not valid on a group)", () => {
    render(
      <FieldGroup label="Administered by" error="Pick one.">
        <Checkbox label="Self" />
      </FieldGroup>,
    )
    const group = screen.getByRole("group", { name: "Administered by" })
    expect(document.getElementById(group.getAttribute("aria-describedby")!)?.textContent).toBe("⚠ Pick one.")
  })
})

describe("Checkbox and Toggle", () => {
  it("makes the whole row one label for the checkbox", () => {
    render(<Checkbox label="Show password" />)
    fireEvent.click(screen.getByText("Show password"))
    expect((screen.getByRole("checkbox", { name: "Show password" }) as HTMLInputElement).checked).toBe(true)
  })

  it("toggles from the label as well as the switch", () => {
    const onChange = vi.fn()
    render(<Toggle label="Active" checked={false} onChange={onChange} />)
    fireEvent.click(screen.getByText("Active"))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it("is a switch with the label's name, and reports a change", () => {
    const onChange = vi.fn()
    render(<Toggle label="Active" checked={false} onChange={onChange} />)
    const toggle = screen.getByRole("switch", { name: "Active" })
    expect(toggle.getAttribute("aria-checked")).toBe("false")
    fireEvent.click(toggle)
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe("FileInput", () => {
  const pdf = () => new File(["x"], "report.pdf", { type: "application/pdf" })

  it("starts with no file chosen and a Choose file button", () => {
    render(<FormField label="Report" hint="PDF, up to 10 MB"><FileInput accept="application/pdf" /></FormField>)
    expect(screen.getByText("No file chosen")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Choose file" })).toBeTruthy()
  })

  it("keeps the real input in the page, labelled by the field label, out of the tab order", () => {
    render(<FormField label="Report"><FileInput /></FormField>)
    const input = screen.getByLabelText("Report")
    expect(input.getAttribute("type")).toBe("file")
    expect(input.tabIndex).toBe(-1)
  })

  it("shows the chosen name, then offers Change file and Remove", () => {
    const onFileChange = vi.fn()
    render(<FormField label="Report"><FileInput onFileChange={onFileChange} /></FormField>)
    fireEvent.change(screen.getByLabelText("Report"), { target: { files: [pdf()] } })
    expect(screen.getByText("report.pdf")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Change file" })).toBeTruthy()
    expect(onFileChange).toHaveBeenLastCalledWith(expect.objectContaining({ name: "report.pdf" }))

    fireEvent.click(screen.getByRole("button", { name: "Remove" }))
    expect(screen.getByText("No file chosen")).toBeTruthy()
    expect(onFileChange).toHaveBeenLastCalledWith(null)
  })

  it("announces a chosen file", () => {
    const messages: string[] = []
    const unsubscribe = subscribeToAnnouncements(m => messages.push(m))
    render(<FormField label="Report"><FileInput /></FormField>)
    fireEvent.change(screen.getByLabelText("Report"), { target: { files: [pdf()] } })
    unsubscribe()
    expect(messages).toEqual(["File chosen: report.pdf"])
  })
})

describe("DateEcho", () => {
  it("spells out a date", () => {
    render(<DateEcho date="2026-10-09" />)
    expect(screen.getByText("Friday 9 October 2026")).toBeTruthy()
  })

  it("spells out a date and time as one line, in the given zone", () => {
    render(<DateEcho date="2026-10-09" time="23:03" timeZone="Europe/London" />)
    expect(screen.getByText("Friday 9 October 2026, 11:03 pm")).toBeTruthy()
  })

  it("renders nothing until the date is valid", () => {
    const { container } = render(<DateEcho date="" />)
    expect(container.textContent).toBe("")
  })
})

describe("announce", () => {
  it("does nothing with no live region mounted, and tells every subscriber otherwise", () => {
    expect(() => announce("Saved")).not.toThrow()
    const seen: [string, string][] = []
    const unsubscribe = subscribeToAnnouncements((m, p) => seen.push([m, p]))
    announce("Saved")
    announce("Problem", "assertive")
    unsubscribe()
    announce("Ignored")
    expect(seen).toEqual([["Saved", "polite"], ["Problem", "assertive"]])
  })
})

describe("form errors", () => {
  function Form() {
    return (
      <form>
        <FormField label="Name" error="Required."><Input /></FormField>
        <FormField label="Dose" error="Must be a number."><Input /></FormField>
        <FormField label="Notes"><Textarea /></FormField>
      </form>
    )
  }

  it("counts the problems and names the first field", () => {
    const { container } = render(<Form />)
    expect(describeProblems(container)?.message).toBe("2 problems to fix. First: Name.")
  })

  it("moves focus to the first invalid field and announces it assertively", () => {
    const seen: [string, string][] = []
    const unsubscribe = subscribeToAnnouncements((m, p) => seen.push([m, p]))
    const { container } = render(<Form />)
    expect(focusFirstInvalid(container)).toBe(true)
    unsubscribe()
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Name" }))
    expect(seen).toEqual([["2 problems to fix. First: Name.", "assertive"]])
  })

  it("does nothing when nothing is invalid", () => {
    const { container } = render(<FormField label="Name"><Input /></FormField>)
    expect(describeProblems(container)).toBeNull()
    expect(focusFirstInvalid(container)).toBe(false)
  })
})
