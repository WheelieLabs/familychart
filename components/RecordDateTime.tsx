// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useId } from "react"
import { Input, Toggle } from "@/components/ui/controls"
import DateEcho from "@/components/ui/DateEcho"
import FormField from "@/components/ui/FormField"
import TimeZoneHint from "@/components/ui/TimeZoneHint"

interface RecordDateTimeProps {
  recordNow: boolean
  onRecordNowChange: (recordNow: boolean) => void
  date: string
  onDateChange: (date: string) => void
  time: string
  onTimeChange: (time: string) => void
  /** The household's zone, which the typed date and time are read in. */
  timeZone?: string
}

/**
 * The "Record now" switch with the Date and Time rows under it, one spelled-out line under the pair
 * ("Friday 9 October 2026, 11:03 pm") and the timezone hint. The rows are disabled while Record now
 * is on, and the reason is shown as text.
 */
export default function RecordDateTime({
  recordNow,
  onRecordNowChange,
  date,
  onDateChange,
  time,
  onTimeChange,
  timeZone,
}: RecordDateTimeProps) {
  const reasonId = useId()
  return (
    <>
      <Toggle label="Record now" checked={recordNow} onChange={onRecordNowChange} />
      <div className="fc-field-pair">
        <FormField label="Date" layout="inline">
          <Input type="date" value={date} disabled={recordNow} aria-describedby={recordNow ? reasonId : undefined}
            onChange={e => onDateChange(e.target.value)} />
        </FormField>
        <FormField label="Time" layout="inline">
          <Input type="time" value={time} disabled={recordNow} aria-describedby={recordNow ? reasonId : undefined}
            onChange={e => onTimeChange(e.target.value)} />
        </FormField>
        {recordNow && (
          <p id={reasonId} className="fc-field__hint">
            The date and time are set to now. Turn off Record now to choose them.
          </p>
        )}
        <DateEcho date={date} time={time} timeZone={timeZone} />
        <TimeZoneHint timeZone={timeZone} />
      </div>
    </>
  )
}
