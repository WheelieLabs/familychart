// SPDX-License-Identifier: AGPL-3.0-only

import { formatDateLong, formatDateTimeLong, getDisplayTimeZone } from "@/lib/date-format"
import { ianaLocalYmdHmToUtcMs } from "@/lib/datetime"

interface DateEchoProps {
  /** The chosen date, `YYYY-MM-DD`, as a date input holds it. */
  date: string
  /** The chosen time, `HH:mm`, when the form has a Time row beside the Date row. */
  time?: string
  /** The zone the date and time are read in. Defaults to the display zone. */
  timeZone?: string
}

/**
 * The line under a date input that spells the chosen date out ("Friday 9 October 2026"), so the
 * person can check what they picked before saving. A form with a Date and a Time row shows one line
 * under the pair ("Friday 9 October 2026, 11:03 pm"). Renders nothing until there is a valid date.
 */
export default function DateEcho({ date, time, timeZone }: DateEchoProps) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  let text: string
  if (time && /^\d{1,2}:\d{2}$/.test(time)) {
    const zone = timeZone ?? getDisplayTimeZone()
    const at = ianaLocalYmdHmToUtcMs(date, time.padStart(5, "0"), zone)
    text = Number.isFinite(at) ? formatDateTimeLong(at, { timeZone: zone }) : formatDateLong(date)
  } else {
    text = formatDateLong(date)
  }
  return text ? <p className="fc-field__echo">{text}</p> : null
}
