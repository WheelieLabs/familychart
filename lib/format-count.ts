// SPDX-License-Identifier: AGPL-3.0-only

/** Formats a count with a correctly pluralised noun, e.g. formatCount(1, "glass", "glasses") -> "1 glass". */
export function formatCount(count: number, singular: string, plural: string = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/**
 * Formats a count with a free-text unit (e.g. a catalogue-defined dosage unit like "Tabs" or "mL")
 * whose singular form isn't known ahead of time. Strips a trailing "s" for a count of 1
 * (e.g. "Tabs" -> "Tab", "Tablets" -> "Tablet"); leaves units without a trailing "s" (e.g. "mL") unchanged.
 */
export function formatUnitCount(count: number, unit: string): string {
  const singularUnit = count === 1 && /[^s]s$/i.test(unit) ? unit.slice(0, -1) : unit
  return `${count} ${singularUnit}`
}
