// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Filter for symptoms whose span touches a window, not only those that start inside it, so a
 * symptom that began in an earlier month still shows on the Calendar. A symptom ends at its end
 * date, else (when resolved) its resolved time, else it is ongoing and never ends.
 * `fromUtc` and `toUtc` are the window's ISO bounds, as produced for the other range filters.
 */
export function appendSymptomOverlapFilters(
  conditions: string[],
  values: (string | number)[],
  fromUtc: string,
  toUtc: string,
): void {
  conditions.push("start_date <= ?")
  values.push(toUtc)
  conditions.push(
    "COALESCE(end_date, CASE WHEN is_resolved = 1 THEN COALESCE(resolved_at, start_date) ELSE '9999-12-31' END) >= ?",
  )
  values.push(fromUtc)
}
