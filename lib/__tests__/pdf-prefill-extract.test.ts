import { describe, expect, it } from "vitest"
import {
  buildLines,
  extractFromPages,
  parseCollectionDate,
  type PdfLine,
  type PdfPageText,
  type PdfTextItem,
} from "@/lib/test-results/pdf-prefill/extract"

type Cell = [x: number, text: string]

function line(y: number, ...cells: Cell[]): PdfLine {
  return { y, items: cells.map(([x, s]) => ({ s, x, y, w: s.length * 5, h: 9 })) }
}

function page(lines: PdfLine[], height = 800): PdfPageText {
  return { page: 1, height, lines }
}

const summary = (rows: ReturnType<typeof extractFromPages>["rows"]) =>
  rows.map(r => ({ name: r.name, value: r.value, qualifier: r.qualifier, unit: r.unit, range: r.range }))

describe("buildLines", () => {
  it("clusters items by baseline and orders each line left to right", () => {
    const items: PdfTextItem[] = [
      { s: "135", x: 200, y: 500.4, w: 15, h: 9 },
      { s: "Sodium", x: 40, y: 500, w: 30, h: 9 },
      { s: "Potassium", x: 40, y: 480, w: 45, h: 9 },
      { s: "  ", x: 10, y: 500, w: 3, h: 9 },
    ]
    const lines = buildLines(items)
    expect(lines).toHaveLength(2)
    expect(lines[0]!.items.map(i => i.s)).toEqual(["Sodium", "135"])
    expect(lines[1]!.items.map(i => i.s)).toEqual(["Potassium"])
  })
})

describe("layout 1: single-line table with a bracketed range", () => {
  it("reads name, value, range and unit, ignoring the report's own flag", () => {
    const { rows } = extractFromPages([page([
      line(600, [40, "Ferritin"], [200, "62"], [260, "[30 - 500]"], [330, "µg/L"]),
      line(580, [40, "Haemoglobin"], [200, "98"], [230, "L"], [260, "[115 - 165]"], [330, "g/L"]),
    ])])
    expect(summary(rows)).toEqual([
      { name: "Ferritin", value: 62, qualifier: null, unit: "µg/L", range: "30 - 500" },
      { name: "Haemoglobin", value: 98, qualifier: null, unit: "g/L", range: "115 - 165" },
    ])
  })

  it("keeps a limit qualifier beside the number", () => {
    const { rows } = extractFromPages([page([
      line(600, [40, "C-Reactive Protein"], [200, "<5"], [260, "[0 - 5]"], [330, "mg/L"]),
      line(580, [40, "eGFR"], [200, ">90"], [260, "[>60]"], [330, "mL/min/1.73m²"]),
    ])])
    expect(rows.map(r => [r.value, r.qualifier])).toEqual([[5, "<"], [90, ">"]])
  })

  it("splits a fused value and flag item", () => {
    const { rows } = extractFromPages([page([
      line(600, [40, "HbA1c"], [200, "6.5 H"], [260, "(<48)"], [330, "mmol/mol"]),
    ])])
    expect(summary(rows)).toEqual([
      { name: "HbA1c", value: 6.5, qualifier: null, unit: "mmol/mol", range: "<48" },
    ])
  })
})

describe("layout 2: table with a parenthesised range and unit", () => {
  it("takes a unit fused after the closing bracket", () => {
    const { rows } = extractFromPages([page([
      line(600, [40, "Sodium"], [200, "139"], [260, "(135 - 145) mmol/L"]),
      line(580, [40, "Potassium"], [200, "4.1"], [260, "(3.5 - 5.2)"], [340, "mmol/L"]),
    ])])
    expect(summary(rows)).toEqual([
      { name: "Sodium", value: 139, qualifier: null, unit: "mmol/L", range: "135 - 145" },
      { name: "Potassium", value: 4.1, qualifier: null, unit: "mmol/L", range: "3.5 - 5.2" },
    ])
  })
})

describe("layout 3: inline multi-analyte lines with abbreviated names", () => {
  it("reads several analytes from one line", () => {
    const { rows } = extractFromPages([page([
      line(600, [40, "Na 139 mmol/L (135 - 145)  K 4.1 mmol/L (3.5 - 5.2)  Creat 71 umol/L (45 - 90)"]),
    ])])
    expect(summary(rows)).toEqual([
      { name: "Na", value: 139, qualifier: null, unit: "mmol/L", range: "135 - 145" },
      { name: "K", value: 4.1, qualifier: null, unit: "mmol/L", range: "3.5 - 5.2" },
      { name: "Creat", value: 71, qualifier: null, unit: "umol/L", range: "45 - 90" },
    ])
  })
})

describe("layout 4: date and request-number grid with the metric as a column header", () => {
  const grid = page([
    line(700, [40, "Date"], [100, "Req No"], [200, "TSH"], [300, "Free T4"]),
    line(688, [200, "(0.4 - 4.0)"], [300, "(10 - 20)"], [20, "Ref Range"]),
    line(670, [40, "12/08/2025"], [100, "25123456"], [200, "2.5"], [250, "mU/L"], [300, "14"], [350, "pmol/L"]),
  ])

  it("reads the column header as the name and supports two result columns", () => {
    const { rows } = extractFromPages([grid])
    expect(summary(rows)).toEqual([
      { name: "TSH", value: 2.5, qualifier: null, unit: "mU/L", range: "0.4 - 4.0" },
      { name: "Free T4", value: 14, qualifier: null, unit: "pmol/L", range: "10 - 20" },
    ])
  })

  it("keeps the column header in the source strip region and text", () => {
    const { rows } = extractFromPages([grid])
    expect(rows[0]!.text).toContain("TSH")
    expect(rows[0]!.strip.top).toBeGreaterThan(700)
    expect(rows[0]!.strip.bottom).toBeLessThan(670)
  })

  it("does not treat the request number as a result", () => {
    const { rows } = extractFromPages([grid])
    expect(rows.some(r => r.value === 25123456)).toBe(false)
  })
})

describe("layout 5: units that appear only in a header line", () => {
  it("applies the header unit to rows that print none", () => {
    const { rows } = extractFromPages([page([
      line(700, [40, "Test"], [200, "Result mmol/L"], [300, "Reference"]),
      line(680, [40, "Sodium"], [200, "139"], [300, "135 - 145"]),
      line(660, [40, "Potassium"], [200, "4.1"], [300, "(3.5 - 5.2)"]),
    ])])
    expect(summary(rows)).toEqual([
      { name: "Sodium", value: 139, qualifier: null, unit: "mmol/L", range: null },
      { name: "Potassium", value: 4.1, qualifier: null, unit: "mmol/L", range: "3.5 - 5.2" },
    ])
  })
})

describe("noise the extractor must ignore", () => {
  it("skips the footer band and report furniture", () => {
    const { rows } = extractFromPages([page([
      line(600, [40, "Sodium"], [200, "139"], [260, "(135 - 145)"], [340, "mmol/L"]),
      line(40, [40, "Page"], [80, "1"], [100, "of"], [120, "2"], [200, "10 mg/L (1 - 2)"]),
      line(580, [40, "Medicare No"], [200, "2123"], [260, "(1 - 2)"], [340, "mg/L"]),
    ])])
    expect(rows.map(r => r.name)).toEqual(["Sodium"])
  })

  it("skips interpretation and guideline prose until the next table header", () => {
    const { rows } = extractFromPages([page([
      line(700, [40, "Ferritin"], [200, "62"], [260, "[30 - 500]"], [330, "µg/L"]),
      line(680, [40, "Interpretation"]),
      line(664, [40, "Levels below"], [120, "30"], [160, "mmol/L"], [200, "(see guideline 2)"]),
      line(648, [40, "Test"], [200, "Result"], [300, "Units"]),
      line(630, [40, "Albumin"], [200, "40"], [260, "[35 - 50]"], [330, "g/L"]),
    ])])
    expect(rows.map(r => r.name)).toEqual(["Ferritin", "Albumin"])
  })

  it("rejects rows with a long prose name", () => {
    const { rows } = extractFromPages([page([
      line(600, [40, "Results should be interpreted in the context of"], [300, "10"], [340, "mmol/L"]),
    ])])
    expect(rows).toEqual([])
  })

  it("returns nothing for a page with no results", () => {
    expect(extractFromPages([page([line(600, [40, "Hello world"])])]).rows).toEqual([])
  })
})

describe("report metadata", () => {
  it.each([
    ["Collection Date 12-Aug-25", "2025-08-12"],
    ["COLLECTED: 05/09/2025", "2025-09-05"],
    ["Date collected: 2025-10-01", "2025-10-01"],
    ["Collected on 3 Mar 2024", "2024-03-03"],
    ["Reported 12/08/2025", null],
    ["Collection Date 32/13/2025", null],
  ])("parses %s", (text, expected) => {
    expect(parseCollectionDate(text)).toBe(expected)
  })

  it("finds the collection date and a title suggestion on the page", () => {
    const { meta } = extractFromPages([page([
      { y: 780, items: [{ s: "Thyroid Function Panel", x: 40, y: 780, w: 120, h: 18 }] },
      line(760, [40, "Collection Date 12-Aug-25"]),
      line(740, [40, "Patient"], [100, "Pat Example"]),
    ])])
    expect(meta).toEqual({ collectedYmd: "2025-08-12", title: "Thyroid Function Panel" })
  })

  it("offers no title when nothing looks like one", () => {
    expect(extractFromPages([page([line(780, [40, "Some Laboratory"])])]).meta.title).toBeNull()
  })
})

// Synthetic layout shaped like an SA Pathology report: made-up values, never a real report.
describe("SA Pathology layout", () => {
  const COL = { name: 40, value: 230, flag: 262, foot: 280, range: 310, unit: 390 }

  const headerLines = [
    line(700, [40, "Clinical Notes"], [130, "Fasting sample"]),
    line(680, [40, "Collection Time"], [230, "Result"], [310, "Reference"], [390, "Units"]),
  ]
  const noClinicalHeader = [
    line(700, [40, "Clinical Notes"], [130, "Fasting sample"]),
    line(680, [40, "Collection Time"], [310, "Reference"], [390, "Units"]),
  ]

  it("ends the Clinical Notes prose skip at a Reference Units header", () => {
    const { rows } = extractFromPages([page([
      ...noClinicalHeader,
      line(660, [COL.name, "Sodium"], [COL.value, "139"], [COL.range, "[135-145]"], [COL.unit, "mmol/L"]),
    ])])
    expect(summary(rows)).toEqual([{ name: "Sodium", value: 139, qualifier: null, unit: "mmol/L", range: "135-145" }])
  })

  it("still skips prose that follows a notes heading until a table header", () => {
    const { rows } = extractFromPages([page([
      line(700, [40, "Clinical Notes"]),
      line(680, [40, "Patient reports tiredness 12 weeks"]),
      line(660, [40, "Collection Time"], [310, "Reference"], [390, "Units"]),
    ])])
    expect(rows).toEqual([])
  })

  it("never reads a footnote marker as the range", () => {
    const { rows } = extractFromPages([page([
      ...headerLines,
      line(660, [COL.name, "Haemoglobin"], [COL.value, "98"], [COL.flag, "L"], [COL.foot, "[1]"], [COL.range, "[115-165]"], [COL.unit, "g/L"]),
      line(640, [COL.name, "Ferritin"], [COL.value, "62"], [COL.foot, "[2]"], [COL.range, "[30-500]"], [COL.unit, "µg/L"]),
      line(620, [COL.name, "Platelet Count"], [COL.value, "250"], [COL.foot, "[1] [150-400]"], [COL.unit, "x10^9/L"]),
    ])])
    expect(summary(rows).map(r => [r.name, r.range])).toEqual([
      ["Haemoglobin", "115-165"], ["Ferritin", "30-500"], ["Platelet Count", "150-400"],
    ])
  })

  it("reads a bound range such as [>=60]", () => {
    const { rows } = extractFromPages([page([
      ...headerLines,
      line(660, [COL.name, "eGFR"], [COL.value, "85"], [COL.range, "[>=60]"], [COL.unit, "mL/min/1.73m²"]),
    ])])
    expect(summary(rows)).toEqual([{ name: "eGFR", value: 85, qualifier: null, unit: "mL/min/1.73m²", range: ">=60" }])
  })

  it("keeps a percentage row's % unit so it can be told from the count", () => {
    const { rows } = extractFromPages([page([
      ...headerLines,
      line(660, [COL.name, "Neutrophils"], [COL.value, "4.1"], [COL.range, "[2.0-7.5]"], [COL.unit, "x10^9/L"]),
      line(640, [COL.name, "Neutrophils %"], [COL.value, "60"], [COL.range, "[40-75]"], [COL.unit, "%"]),
    ])])
    expect(summary(rows).map(r => [r.name, r.unit])).toEqual([["Neutrophils", "x10^9/L"], ["Neutrophils %", "%"]])
  })

  it("joins a name that wraps below its row", () => {
    const { rows } = extractFromPages([page([
      ...headerLines,
      line(660, [COL.name, "Estimated GFR (CKD-EPI"], [COL.value, "85"], [COL.range, "[>=60]"], [COL.unit, "mL/min/1.73m²"]),
      line(650, [COL.name, "2009 equation)"]),
      line(630, [COL.name, "Sodium"], [COL.value, "139"], [COL.range, "[135-145]"], [COL.unit, "mmol/L"]),
    ])])
    expect(summary(rows).map(r => [r.name, r.value])).toEqual([["Estimated GFR (CKD-EPI 2009 equation)", 85], ["Sodium", 139]])
    expect(rows[0]!.text).toContain("2009 equation)")
  })

  it("joins a name that wraps above its row", () => {
    const { rows } = extractFromPages([page([
      ...headerLines,
      line(660, [COL.name, "Estimated GFR (CKD-EPI"]),
      line(650, [COL.name, "2009 equation)"], [COL.value, "85"], [COL.range, "[>=60]"], [COL.unit, "mL/min/1.73m²"]),
    ])])
    expect(summary(rows).map(r => [r.name, r.value])).toEqual([["Estimated GFR (CKD-EPI 2009 equation)", 85]])
  })

  it("does not glue an ordinary section heading onto the next row", () => {
    const { rows } = extractFromPages([page([
      ...headerLines,
      line(660, [40, "Renal Function"]),
      line(640, [COL.name, "Sodium"], [COL.value, "139"], [COL.range, "[135-145]"], [COL.unit, "mmol/L"]),
    ])])
    expect(rows.map(r => r.name)).toEqual(["Sodium"])
  })
})
