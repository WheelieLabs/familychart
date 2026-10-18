// SPDX-License-Identifier: AGPL-3.0-only

import { getDisplayTimeZone } from "@/lib/display-time-zone"
import { deviceZoneDiffersFrom } from "@/lib/datetime"

/**
 * "Times are in Europe/London" under a time field, shown only when this device's clock differs from
 * the household's, so a carer travelling knows which zone the time they type is read in.
 */
export default function TimeZoneHint({ timeZone }: { timeZone?: string }) {
  const zone = timeZone ?? getDisplayTimeZone()
  if (zone === "UTC" && timeZone == null) return null
  if (!deviceZoneDiffersFrom(zone)) return null
  return <p className="fc-field__hint">Times are in {zone}</p>
}
