// SPDX-License-Identifier: AGPL-3.0-only

let displayTimeZone = "UTC"

/**
 * The instance timezone: the zone dates are displayed in and typed dates and times are read in.
 * Client code sets it once from `GET /api/me` (`instanceTimezone`); server code passes `timeZone`
 * explicitly instead of relying on shared state.
 */
export function getDisplayTimeZone(): string {
  return displayTimeZone
}

export function setDisplayTimeZone(timeZone: string): void {
  displayTimeZone = timeZone
}
