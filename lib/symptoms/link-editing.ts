// SPDX-License-Identifier: AGPL-3.0-only

import { localDateToIsoYmd } from "../datetime"

/** Pending link changes on an edit screen; applied together when the record is saved. */
export interface LinkDelta {
  add: number[]
  remove: number[]
}

export const EMPTY_LINK_DELTA: LinkDelta = { add: [], remove: [] }

export function isEmptyDelta(d: LinkDelta): boolean {
  return d.add.length === 0 && d.remove.length === 0
}

/** Removes a linked item (undoable); removing an item that was only just picked simply drops the pick. */
export function removeLinked(d: LinkDelta, id: number): LinkDelta {
  if (d.add.includes(id)) return { ...d, add: d.add.filter(x => x !== id) }
  return d.remove.includes(id) ? d : { ...d, remove: [...d.remove, id] }
}

export function undoRemove(d: LinkDelta, id: number): LinkDelta {
  return { ...d, remove: d.remove.filter(x => x !== id) }
}

/** Picks an item to link; picking one that is already linked (and pending removal) just cancels the removal. */
export function pickToLink(d: LinkDelta, id: number, linkedIds: readonly number[]): LinkDelta {
  if (d.remove.includes(id)) return undoRemove(d, id)
  if (linkedIds.includes(id) || d.add.includes(id)) return d
  return { ...d, add: [...d.add, id] }
}

/** What the edit screen shows as linked right now: saved links minus pending removals, plus pending picks. */
export function effectiveLinkedIds(linkedIds: readonly number[], d: LinkDelta): number[] {
  return [...linkedIds.filter(id => !d.remove.includes(id)), ...d.add.filter(id => !linkedIds.includes(id))]
}

/** Groups items by local calendar day, keeping the given order (callers pass newest first). */
export function groupByLocalDay<T>(items: readonly T[], isoOf: (item: T) => string): { day: string; items: T[] }[] {
  const groups: { day: string; items: T[] }[] = []
  for (const item of items) {
    const day = localDateToIsoYmd(new Date(isoOf(item)))
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.items.push(item)
    else groups.push({ day, items: [item] })
  }
  return groups
}

interface LinkLike {
  symptom_event_id: number
  medication_record_id: number
}

/** Index of a Person's links by one side, for History rows. */
export function groupLinksBy<T extends LinkLike>(links: readonly T[], side: "symptom" | "dose"): Map<number, T[]> {
  const out = new Map<number, T[]>()
  for (const l of links) {
    const key = side === "symptom" ? l.symptom_event_id : l.medication_record_id
    out.set(key, [...(out.get(key) ?? []), l])
  }
  return out
}

/** Chip text: the symptom's name for one link, a count for several. */
export function doseChipLabel(symptomLabels: readonly string[]): string {
  return symptomLabels.length === 1 ? `For: ${symptomLabels[0]}` : `For ${symptomLabels.length} symptoms`
}

export function symptomChipLabel(doseCount: number): string {
  return `${doseCount} dose${doseCount === 1 ? "" : "s"} linked`
}
