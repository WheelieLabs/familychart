// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest"
import { describeTimingPrompt, promptFromTiming } from "@/lib/schedule/dose-timing-prompt"

const needsPrompt = (over: { previousSlot?: string | null; nextSlot?: string | null; earlierOpenSlots?: string[] }) => ({
  kind: "needs_prompt" as const,
  personMedicationId: 1,
  ymd: "2025-01-15",
  previousSlot: "08:00",
  nextSlot: "12:00",
  earlierOpenSlots: [] as string[],
  ...over,
})

describe("promptFromTiming", () => {
  it("only prompts for a dose outside every slot window", () => {
    expect(promptFromTiming({ kind: "unscheduled" })).toBeNull()
    expect(promptFromTiming({ kind: "extra" })).toBeNull()
    expect(promptFromTiming({ kind: "on_time", personMedicationId: 1, ymd: "2025-01-15", slotHhmm: "08:00", offsetMinutes: 3 })).toBeNull()
    expect(promptFromTiming(undefined)).toBeNull()
    expect(promptFromTiming(needsPrompt({}))).not.toBeNull()
  })
})

describe("describeTimingPrompt", () => {
  it("names both neighbouring doses and offers Late, Early and Extra", () => {
    const p = describeTimingPrompt(needsPrompt({ earlierOpenSlots: ["08:00"] }))
    expect(p.lead).toBe("Not at a scheduled time")
    expect(p.message).toBe(
      "between the 8:00 am and 12:00 pm doses. Which dose was this? Early marks earlier open doses as missed. If you don't answer, it stays an extra dose.",
    )
    expect(p.options).toEqual([
      { answer: "late", label: "Late 8:00 am" },
      { answer: "early", label: "Early 12:00 pm" },
      { answer: "extra", label: "Extra dose" },
    ])
  })

  it("before the first dose there is no Late option", () => {
    const p = describeTimingPrompt(needsPrompt({ previousSlot: null }))
    expect(p.message.startsWith("before the 12:00 pm dose. Which dose was this?")).toBe(true)
    expect(p.options.map(o => o.answer)).toEqual(["early", "extra"])
  })

  it("after the last dose there is no Early option and no missed-slots line", () => {
    const p = describeTimingPrompt(needsPrompt({ nextSlot: null }))
    expect(p.message).toBe("after the 8:00 am dose. Which dose was this? If you don't answer, it stays an extra dose.")
    expect(p.options.map(o => o.answer)).toEqual(["late", "extra"])
  })

  it("says Early marks earlier open doses missed only when it would", () => {
    expect(describeTimingPrompt(needsPrompt({ earlierOpenSlots: [] })).message).not.toContain("marks earlier")
    expect(describeTimingPrompt(needsPrompt({ earlierOpenSlots: ["08:00"] })).message).toContain("marks earlier")
  })
})
