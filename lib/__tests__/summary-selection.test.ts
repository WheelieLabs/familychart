import { describe, expect, it } from "vitest"
import { parseSummaryRecord, summaryListUrl, summaryRecordUrl } from "@/lib/history/summary-selection"

describe("summary selection URLs", () => {
  it("builds the list URL for a kind", () => {
    expect(summaryListUrl("medication")).toBe("?tab=summaries&summary=medication")
  })

  it("adds the opened record to the list URL, encoded", () => {
    expect(summaryRecordUrl("observation", "Blood Pressure")).toBe("?tab=summaries&summary=observation&record=Blood%20Pressure")
    expect(summaryRecordUrl("symptom", "sore throat & cough")).toBe("?tab=summaries&summary=symptom&record=sore%20throat%20%26%20cough")
  })

  it("round-trips a record through the URL", () => {
    const key = "iron / ferritin %"
    const url = new URLSearchParams(summaryRecordUrl("test_result", key).slice(1))
    expect(parseSummaryRecord(url.get("record"))).toBe(key)
  })

  it("treats a missing or blank record as the list", () => {
    expect(parseSummaryRecord(null)).toBeNull()
    expect(parseSummaryRecord("")).toBeNull()
    expect(parseSummaryRecord("   ")).toBeNull()
  })
})
