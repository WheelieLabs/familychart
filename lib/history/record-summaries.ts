// SPDX-License-Identifier: AGPL-3.0-only

import type { SymptomEventSummary } from "@/lib/symptoms/symptom-history"
import type { TestResultSummary } from "@/lib/test-results/test-result-history"

/** One History > Summaries entry: a symptom or a test, with its record count and most recent date. */
export interface RecordSummary {
  key: string
  label: string
  count: number
  /** ISO timestamp of the most recent record. */
  lastDate: string
}

/** Case- and spacing-insensitive identity for a free-text symptom label or test name. */
function keyOf(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ")
}

function summarise<T>(items: T[], textOf: (t: T) => string, dateOf: (t: T) => string): RecordSummary[] {
  const groups = new Map<string, RecordSummary>()
  for (const item of items) {
    const key = keyOf(textOf(item))
    const date = dateOf(item)
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, { key, label: textOf(item).trim(), count: 1, lastDate: date })
    } else {
      existing.count++
      // The most recent record decides the spelling shown.
      if (date > existing.lastDate) {
        existing.lastDate = date
        existing.label = textOf(item).trim()
      }
    }
  }
  return [...groups.values()].sort((a, b) => (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : a.label.localeCompare(b.label)))
}

function forKey<T>(items: T[], key: string, textOf: (t: T) => string, dateOf: (t: T) => string): T[] {
  return items
    .filter(i => keyOf(textOf(i)) === key)
    .sort((a, b) => (dateOf(a) < dateOf(b) ? 1 : dateOf(a) > dateOf(b) ? -1 : 0))
}

export const summariseSymptoms = (events: SymptomEventSummary[]) =>
  summarise(events, e => e.label, e => e.start_date)

export const summariseTestResults = (results: TestResultSummary[]) =>
  summarise(results, r => r.name, r => r.date)

export const symptomsForKey = (events: SymptomEventSummary[], key: string) =>
  forKey(events, key, e => e.label, e => e.start_date)

export const testResultsForKey = (results: TestResultSummary[], key: string) =>
  forKey(results, key, r => r.name, r => r.date)
