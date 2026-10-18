import { describe, expect, it } from "vitest"
import { buildLines, extractFromPages, type PdfPageText, type PdfTextItem } from "@/lib/test-results/pdf-prefill/extract"
import { boxForItems, boxFromCorners, itemTouchesBox, keptItems, removedItems, type PageBox } from "@/lib/test-results/redaction/boxes"
import { CATEGORY_LABEL, isMedicareNumber, suggestIdentifiers } from "@/lib/test-results/redaction/detect"
import { repeatedBoxes } from "@/lib/test-results/redaction/repeats"
import { redactPdfPages, verifyRedactedPdf } from "@/lib/test-results/redaction/redact-pdf"
import {
  addManualBox, initialPageReview, removeManualBox, toggleSuggestion, undoManualBox,
} from "@/lib/test-results/redaction/review-state"
import { decodedPdfText, leakedStrings } from "@/lib/test-results/redaction/verify"
import { makeSyntheticPdf, SYNTHETIC_DOB, SYNTHETIC_MEDICARE, SYNTHETIC_NAME } from "./helpers/synthetic-report"

const PAGE = { widthPt: 595, heightPt: 842 }
const item = (s: string, x: number, y: number, w = 60, h = 10): PdfTextItem => ({ s, x, y, w, h })

describe("boxes", () => {
  it("covers an item and touches only what it overlaps", () => {
    const patient = item("Patient: TESTPERSON", 40, 780, 120)
    const row = item("Ferritin", 40, 700)
    const box = boxForItems([patient], PAGE)
    expect(itemTouchesBox(patient, box, PAGE)).toBe(true)
    expect(itemTouchesBox(row, box, PAGE)).toBe(false)
    expect(keptItems([patient, row], [box], PAGE)).toEqual([row])
    expect(removedItems([patient, row], [box], PAGE)).toEqual([patient])
  })

  it("keeps boxes inside the page, in fractions from the top-left", () => {
    const box = boxForItems([item("edge", 590, 835, 60)], PAGE)
    expect(box.x).toBeGreaterThan(0.9)
    expect(box.x + box.w).toBeLessThanOrEqual(1)
    expect(box.y).toBeGreaterThanOrEqual(0)
  })

  it("leaves the line above or below alone when a padded box only grazes its margin", () => {
    // Lines 15pt apart: the box over the middle line must not take the neighbours' text.
    const above = item("Patient: TESTPERSON", 40, 780, 120)
    const middle = item("DOB: 04/07/1961", 40, 765, 80)
    const below = item("Address: 1 Example Street", 40, 750, 120)
    const box = boxForItems([middle], PAGE)
    expect(keptItems([above, middle, below], [box], PAGE)).toEqual([above, below])
  })

  it("drops a partly covered item whole, so a neighbouring item on the line is lost, never leaked", () => {
    const left = item("Haemoglobin", 40, 700, 70)
    const box = boxForItems([left], PAGE)
    const wide = item("Haemoglobin 135 g/L", 40, 700, 200)
    expect(keptItems([wide], [box], PAGE)).toEqual([])
  })

  it("builds a drawn box from two corners in any direction, and ignores a stray tap", () => {
    expect(boxFromCorners({ x: 0.5, y: 0.5 }, { x: 0.2, y: 0.3 })).toEqual({ x: 0.2, y: 0.3, w: 0.3, h: 0.2 })
    expect(boxFromCorners({ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.505 })).toBeNull()
    expect(boxFromCorners({ x: -1, y: -1 }, { x: 2, y: 2 })).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })
})

describe("detection", () => {
  it("accepts a valid Medicare number and rejects a changed digit", () => {
    expect(isMedicareNumber(SYNTHETIC_MEDICARE.replace(/ /g, "").slice(0, 10))).toBe(true)
    expect(isMedicareNumber("2123456711")).toBe(false)
  })

  const items = [
    item("Patient: TESTPERSON, Alex", 40, 780, 130),
    item("DOB: 04/07/1961", 40, 765, 80),
    item(`Medicare: ${SYNTHETIC_MEDICARE}`, 300, 765, 120),
    item("Address: 1 Example Street, Testville", 40, 750, 170),
    item("SA 5000", 40, 738, 40),
    item("Request No: ABC123", 40, 720, 100),
    item("Phone 0412 345 678", 300, 750, 90),
    item("alex@example.com", 300, 740, 90),
    item("Ferritin", 40, 700),
  ]
  const suggestions = suggestIdentifiers(items)
  const by = (c: string) => suggestions.filter(s => s.category === c)

  it("suggests each identifier, and boxes the sensitive ones in advance", () => {
    for (const c of ["medicare", "dob", "address", "phone", "email"]) expect(by(c).length, c).toBeGreaterThan(0)
    expect(suggestions.filter(s => s.preBoxed).map(s => s.category).sort()).toEqual(
      ["address", "dob", "email", "medicare", "phone"],
    )
  })

  it("offers the patient name and request number without boxing them", () => {
    expect(by("name")[0]?.preBoxed).toBe(false)
    expect(by("request")[0]?.preBoxed).toBe(false)
    expect(CATEGORY_LABEL.name).toBe("Patient name")
  })

  it("takes the next line of an address when it ends in a state and postcode", () => {
    expect(by("address")[0]!.items.map(i => i.s)).toContain("SA 5000")
  })

  it("takes the value beside a label in a two-column header, not just the label", () => {
    // "Patient:" at one edge, the name aligned about 40 pt to its right (as on a laboratory header).
    const header = suggestIdentifiers([
      item("Patient:", 330, 700, 28),
      item("DOE, JANE", 412, 700, 70),
      item("Referred By:", 330, 685, 50),
      item("DR EXAMPLE", 412, 685, 60),
    ])
    const name = header.find(s => s.category === "name")!
    expect(name.items.map(i => i.s)).toEqual(["Patient:", "DOE, JANE"])
  })

  it("leaves ordinary result rows alone", () => {
    expect(suggestions.some(s => s.items.some(i => i.s === "Ferritin"))).toBe(false)
  })
})

describe("review state", () => {
  const suggestions = suggestIdentifiers([item("DOB: 04/07/1961", 40, 765, 80), item("Patient: Alex", 40, 780, 80)])
  it("starts with the sensitive suggestions on and the name off, and toggles them", () => {
    let review = initialPageReview(suggestions)
    const dob = suggestions.find(s => s.category === "dob")!
    const name = suggestions.find(s => s.category === "name")!
    expect(review.on).toEqual([dob.id])
    review = toggleSuggestion(review, name.id)
    expect(review.on).toContain(name.id)
    review = toggleSuggestion(review, dob.id)
    expect(review.on).toEqual([name.id])
  })

  it("adds, removes and undoes hand-drawn boxes", () => {
    const a: PageBox = { x: 0.1, y: 0.1, w: 0.2, h: 0.1 }
    const b: PageBox = { x: 0.5, y: 0.5, w: 0.2, h: 0.1 }
    let review = addManualBox(addManualBox(initialPageReview([]), a), b)
    expect(review.manual).toEqual([a, b])
    expect(removeManualBox(review, 0).manual).toEqual([b])
    review = undoManualBox(review)
    expect(review.manual).toEqual([a])
  })
})

describe("verification", () => {
  it("finds a secret in decoded text runs that a plain scan would miss, and in plain bytes", () => {
    const bytes = new TextEncoder().encode("1 0 obj [<46> 30 <657272> -15 <6974696e>] TJ plainsecret")
    expect(decodedPdfText(bytes)).toContain("Ferritin")
    expect(leakedStrings(["Ferritin", "plainsecret", "absent"], `${decodedPdfText(bytes)}\n${new TextDecoder("latin1").decode(bytes)}`, "").sort()).toEqual(["Ferritin", "plainsecret"])
  })

  it("ignores very short strings that would match anywhere", () => {
    expect(leakedStrings(["a", "12"], "a 12", "")).toEqual([])
  })

  it("does not call a string a leak when the same text is legitimately left visible elsewhere", () => {
    // Boxed on one page, printed again unboxed on another: counted on both sides, so not a leak.
    expect(leakedStrings(["24-243-07520"], "x 24-243-07520 y", "x 24-243-07520 y")).toEqual([])
    // But a surviving boxed copy on top of the kept one is.
    expect(leakedStrings(["24-243-07520"], "24-243-07520 and 24-243-07520", "24-243-07520")).toEqual(["24-243-07520"])
  })
})

describe("redacting a PDF end to end (synthetic data only)", () => {
  async function pdfItems(data: Uint8Array) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
    const doc = await pdfjs.getDocument({ data: data.slice(), useSystemFonts: true }).promise
    const pages: { items: PdfTextItem[]; size: { widthPt: number; heightPt: number } }[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      pages.push({
        items: content.items.flatMap(it => ("str" in it ? [{ s: it.str, x: it.transform[4]!, y: it.transform[5]!, w: it.width, h: it.height }] : [])),
        size: { widthPt: page.view[2]!, heightPt: page.view[3]! },
      })
    }
    return pages
  }
  const rowsOf = (pages: { items: PdfTextItem[]; size: { heightPt: number } }[]) => {
    const text: PdfPageText[] = pages.map((p, i) => ({ page: i + 1, height: p.size.heightPt, lines: buildLines(p.items) }))
    return extractFromPages(text).rows.map(r => [r.name, r.value, r.qualifier, r.unit, r.range])
  }
  const blankJpeg = async () => {
    const sharp = (await import("sharp")).default
    return new Uint8Array(await sharp({ create: { width: 200, height: 280, channels: 3, background: "#fff" } }).jpeg().toBuffer())
  }

  it("keeps every result row extractable, removes the boxed text, and passes its own verification", async () => {
    const original = await pdfItems(await makeSyntheticPdf(2))
    const originalRows = rowsOf(original)
    expect(originalRows.length).toBeGreaterThan(40)

    const pages = original.map(p => {
      const boxed = suggestIdentifiers(p.items).filter(s => s.preBoxed || s.category === "name").flatMap(s => s.items)
      return { size: p.size, items: p.items, boxes: boxed.length ? [boxForItems(boxed, p.size)] : [] }
    })
    // One box over the whole patient block of page 1: everything inside is dropped; result rows are far below it.
    const out = await redactPdfPages(pages, async () => blankJpeg())
    expect(out.removedText.join("\n")).toContain("TESTPERSON")

    const readBack = await pdfItems(out.bytes)
    expect(rowsOf(readBack)).toEqual(originalRows)
    const text = readBack.flatMap(p => p.items.map(i => i.s)).join("\n")
    for (const secret of [SYNTHETIC_NAME, SYNTHETIC_MEDICARE, SYNTHETIC_DOB.replace("DOB: ", ""), "Example Street"]) {
      expect(text).not.toContain(secret)
    }

    const verdict = await verifyRedactedPdf(out, 2, async bytes => (await pdfItems(bytes)).map(p => p.items.map(i => i.s).join("\n")))
    expect(verdict).toEqual({ ok: true, problems: [] })
  })

  it("fails verification when a boxed string is still in the file", async () => {
    const original = await pdfItems(await makeSyntheticPdf(1))
    const pages = original.map(p => ({ size: p.size, items: p.items, boxes: [] as PageBox[] }))
    const out = await redactPdfPages(pages, async () => blankJpeg())
    // Claim a visible word was removed (and is not meant to survive): it is still in the file, so verification must say so.
    const leaky = { ...out, removedText: ["Ferritin"], keptTextByPage: out.keptTextByPage.map(t => t.replaceAll("Ferritin", "")) }
    const verdict = await verifyRedactedPdf(leaky, 1, async bytes => (await pdfItems(bytes)).map(p => p.items.map(i => i.s).join("\n")))
    expect(verdict.ok).toBe(false)
    expect(verdict.problems.join(" ")).toMatch(/still in the file \(page 1\)/)
  })
})

describe("repeated copies of boxed text", () => {
  const size = PAGE
  it("boxes the same value printed again elsewhere, on this page or another, and nothing else", () => {
    const header = item("24-243-07520", 330, 700, 70)
    const body = item("24-243-07520", 220, 400, 70)
    const otherPage = item("24-243-07520", 40, 100, 70)
    const unrelated = item("Ferritin", 40, 380)
    const pages = [
      { size, items: [header, body, unrelated], boxes: [boxForItems([header], size)] },
      { size, items: [otherPage], boxes: [] as PageBox[] },
    ]
    const extra = repeatedBoxes(pages)
    expect(extra[0]).toHaveLength(1) // the body copy; the header is already boxed
    expect(itemTouchesBox(body, extra[0]![0]!, size)).toBe(true)
    expect(itemTouchesBox(unrelated, extra[0]![0]!, size)).toBe(false)
    expect(extra[1]).toHaveLength(1)
  })

  it("does not chase labels or short words, and finds a boxed value inside a longer line", () => {
    const label = item("Patient:", 40, 700, 40)
    const word = item("Page", 40, 600, 20)
    const value = item("DOB 04/07/1961", 40, 500, 80)
    const longer = item("Date of birth 04/07/1961 (age 64)", 40, 300, 160)
    const pages = [{ size, items: [label, word, value, longer], boxes: [boxForItems([label], size), boxForItems([word], size), boxForItems([value], size)] }]
    const extra = repeatedBoxes(pages)[0]!
    // "DOB 04/07/1961" is boxed, so a longer line containing that exact text is chased; labels and "Page" are not.
    expect(extra).toHaveLength(0)
    const pages2 = [{ size, items: [value, item("see DOB 04/07/1961 here", 40, 300, 160)], boxes: [boxForItems([value], size)] }]
    expect(repeatedBoxes(pages2)[0]).toHaveLength(1)
  })

  it("means a detail left in the report's footer no longer fails verification", async () => {
    const original = await pdfItemsOf(await makeSyntheticPdf(1))
    const page = original[0]!
    const dob = page.items.find(i => i.s.startsWith("DOB"))!
    // The same text printed again lower on the page, unboxed by the carer.
    const copy = { ...dob, y: 120 }
    const withCopy = { size: page.size, items: [...page.items, copy], boxes: [boxForItems([dob], page.size)] }
    const [extra] = repeatedBoxes([withCopy])
    const full = { ...withCopy, boxes: [...withCopy.boxes, ...extra!] }
    const out = await redactPdfPages([full], async () => new Uint8Array(await (await import("sharp")).default({ create: { width: 200, height: 280, channels: 3, background: "#fff" } }).jpeg().toBuffer()))
    const verdict = await verifyRedactedPdf(out, 1, async bytes => (await pdfItemsOf(bytes)).map(p => p.items.map(i => i.s).join("\n")))
    expect(verdict.ok).toBe(true)
    expect(out.keptTextByPage[0]).not.toContain("04/07/1961")
  })
})

async function pdfItemsOf(data: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const doc = await pdfjs.getDocument({ data: data.slice(), useSystemFonts: true }).promise
  const pages: { items: PdfTextItem[]; size: { widthPt: number; heightPt: number } }[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    pages.push({
      items: content.items.flatMap(it => ("str" in it ? [{ s: it.str, x: it.transform[4]!, y: it.transform[5]!, w: it.width, h: it.height }] : [])),
      size: { widthPt: page.view[2]!, heightPt: page.view[3]! },
    })
  }
  return pages
}
