import { readFileSync } from "fs"
import path from "path"
import { describe, it, expect } from "vitest"
import { readSheet } from "read-excel-file/node"
import {
  applyColumnMapping,
  classifyRecordType,
  normalizeSpreadsheetMatrix,
  parseCsvToMatrix,
  parseDate,
  rowIsImportable,
  suggestMapping,
  withRecordTypes,
} from "@/lib/spreadsheet-parse"

const fixturePath = path.join(__dirname, "fixtures", "import-sample.xlsx")

describe("parseCsvToMatrix", () => {
  it("parses CSV rows and trims trailing blank lines", () => {
    const rows = parseCsvToMatrix("a,b\n1,2\n,\n")
    expect(rows).toEqual([["a", "b"], ["1", "2"]])
  })

  it("keeps commas inside quoted fields", () => {
    expect(parseCsvToMatrix('"a,b",c\n')).toEqual([["a,b", "c"]])
  })
})

describe("normalizeSpreadsheetMatrix", () => {
  it("pads ragged rows and coerces empty cells to null", () => {
    const rows = normalizeSpreadsheetMatrix([
      ["Date", "Name"],
      ["2024-01-01", undefined],
      ["only-a"],
      [null, null],
    ])
    expect(rows).toEqual([
      ["Date", "Name"],
      ["2024-01-01", null],
      ["only-a", null],
    ])
  })
})

describe("import-sample.xlsx fixture", () => {
  it("reads first worksheet via read-excel-file/node and normalizes like the import page", async () => {
    const buf = readFileSync(fixturePath)
    const raw = await readSheet(buf)
    const rows = normalizeSpreadsheetMatrix(raw)

    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual(["Date", "Medication", "Dose"])
    expect(rows[1]?.[1]).toBe("Paracetamol")
    expect(rows[1]?.[2]).toBe(5)
    expect(rows[2]).toEqual(["ragged row only col A", null, null])

    expect(rows[1]?.[0]).toBe("15/03/2024")
    expect(parseDate(rows[1]?.[0])).toBe("2024-03-15")
  })
})

describe("suggestMapping", () => {
  it("maps date, dose, and BP headers under the observations category", () => {
    expect(suggestMapping("Date", "observations")).toBe("date")
    expect(suggestMapping("Dose", "medications")).toBe("dose")
    expect(suggestMapping("Systolic", "observations")).toBe("bp_systolic")
    expect(suggestMapping("Notes", "both")).toBe("comments")
  })
})

describe("applyColumnMapping / classify / importable", () => {
  it("parses AU dates and dose+unit, then classifies a medication row as importable", () => {
    const drafts = applyColumnMapping(
      ["Date", "Medication", "Dose"],
      { Date: "date", Medication: "medication_name", Dose: "dose" },
      [["15/03/2024", "Paracetamol", "5 mg"]],
    )
    expect(drafts[0]?.date).toBe("2024-03-15")
    expect(drafts[0]?.medication_name).toBe("Paracetamol")
    expect(drafts[0]?.dosage).toBe(5)
    expect(drafts[0]?.dosage_unit).toBe("mg")

    const rows = withRecordTypes("medications", drafts)
    expect(rows[0]?.record_type).toBe("medication")
    expect(rowIsImportable(rows[0]!)).toBe(true)
  })

  it("classifies a BP pair under observations", () => {
    expect(classifyRecordType("observations", {
      _idx: 0,
      date: "2024-03-15",
      time: null,
      comments: null,
      medication_name: null,
      dosage: null,
      dosage_unit: null,
      weight_kg: null,
      observation_type: null,
      obs_value: null,
      obs_unit: null,
      bp_systolic: 120,
      bp_diastolic: 80,
    })).toBe("blood_pressure_pair")
  })
})
