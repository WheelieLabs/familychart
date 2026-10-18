import { describe, expect, it } from "vitest"
import {
  EMPTY_LINK_DELTA,
  effectiveLinkedIds,
  groupByLocalDay,
  isEmptyDelta,
  pickToLink,
  removeLinked,
  undoRemove,
} from "@/lib/symptoms/link-editing"

describe("link editing", () => {
  it("removes a saved link, and undo restores it", () => {
    const removed = removeLinked(EMPTY_LINK_DELTA, 1)
    expect(removed).toEqual({ add: [], remove: [1] })
    expect(effectiveLinkedIds([1, 2], removed)).toEqual([2])
    expect(isEmptyDelta(undoRemove(removed, 1))).toBe(true)
  })

  it("picks new items, ignores already-linked ones, and cancels a pending removal when re-picked", () => {
    let d = pickToLink(EMPTY_LINK_DELTA, 5, [1])
    d = pickToLink(d, 1, [1])
    expect(d).toEqual({ add: [5], remove: [] })
    expect(effectiveLinkedIds([1], d)).toEqual([1, 5])
    d = removeLinked(d, 1)
    expect(pickToLink(d, 1, [1]).remove).toEqual([])
  })

  it("dropping a just-picked item leaves no pending change", () => {
    expect(isEmptyDelta(removeLinked(pickToLink(EMPTY_LINK_DELTA, 5, []), 5))).toBe(true)
  })

  it("groups consecutive items by local day, keeping order", () => {
    const items = [
      { id: 1, at: new Date(2026, 1, 3, 20).toISOString() },
      { id: 2, at: new Date(2026, 1, 3, 8).toISOString() },
      { id: 3, at: new Date(2026, 1, 2, 22).toISOString() },
    ]
    expect(groupByLocalDay(items, i => i.at).map(g => [g.day, g.items.map(i => i.id)])).toEqual([
      ["2026-02-03", [1, 2]],
      ["2026-02-02", [3]],
    ])
  })
})

import { doseChipLabel, groupLinksBy, symptomChipLabel } from "@/lib/symptoms/link-editing"

describe("link chips", () => {
  const links = [
    { symptom_event_id: 1, medication_record_id: 10 },
    { symptom_event_id: 1, medication_record_id: 11 },
    { symptom_event_id: 2, medication_record_id: 10 },
  ]
  it("indexes links by either side", () => {
    expect(groupLinksBy(links, "symptom").get(1)).toHaveLength(2)
    expect(groupLinksBy(links, "dose").get(10)).toHaveLength(2)
    expect(groupLinksBy(links, "dose").get(99)).toBeUndefined()
  })
  it("words the chips compactly", () => {
    expect(doseChipLabel(["Headache"])).toBe("For: Headache")
    expect(doseChipLabel(["Headache", "Fever"])).toBe("For 2 symptoms")
    expect(symptomChipLabel(1)).toBe("1 dose linked")
    expect(symptomChipLabel(3)).toBe("3 doses linked")
  })
})
