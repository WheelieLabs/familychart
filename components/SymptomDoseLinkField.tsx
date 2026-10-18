// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useState } from "react"
import Chip from "@/components/ui/Chip"
import { formatDateShort, formatDateTime } from "@/lib/date-format"
import { dashboardScheduleHeaders } from "@/lib/dashboard/dashboard-client-context"
import { SYMPTOM_FORM_DOSE_CAP, type LinkDose, type LinkSymptom } from "@/lib/symptoms/symptom-dose-link-types"

type Props = {
  personId: string | number
  selected: number[]
  onChange: (ids: number[]) => void
} & (
  | { kind: "dose"; /** Dose time (ISO); its local day decides which symptoms are offered. */ recordedAtIso: string }
  | { kind: "symptom"; startIso: string; endIso: string | null }
)

const whenText = (iso: string) => formatDateTime(iso)
const dayText = (iso: string) => formatDateShort(iso)

/**
 * The optional "link to a symptom / dose" line on the Record forms. Renders nothing (and takes no
 * space) while loading or when there is nothing to link to; Save never depends on it.
 */
export default function SymptomDoseLinkField(props: Props) {
  const { personId, selected, onChange } = props
  const [items, setItems] = useState<{ id: number; title: string; detail: string }[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [open, setOpen] = useState(false)

  const kind = props.kind
  const recordedAtIso = props.kind === "dose" ? props.recordedAtIso : ""
  const startIso = props.kind === "symptom" ? props.startIso : ""
  const endIso = props.kind === "symptom" ? props.endIso : null

  useEffect(() => {
    let cancelled = false
    const qs = new URLSearchParams({ person_id: String(personId) })
    if (kind === "dose") {
      qs.set("candidates", "symptoms")
      qs.set("recorded_at", recordedAtIso)
    } else {
      qs.set("candidates", "doses")
      qs.set("start", startIso)
      if (endIso) qs.set("end", endIso)
      // One more than shown, to know whether earlier doses exist.
      qs.set("limit", String(SYMPTOM_FORM_DOSE_CAP + 1))
    }
    fetch(`/api/symptom-dose-links?${qs}`, { cache: "no-store", headers: dashboardScheduleHeaders() })
      .then(r => (r.ok ? r.json() : []))
      .then((rows: (LinkSymptom | LinkDose)[]) => {
        if (cancelled) return
        const shown = kind === "symptom" ? rows.slice(0, SYMPTOM_FORM_DOSE_CAP) : rows
        setHasMore(kind === "symptom" && rows.length > SYMPTOM_FORM_DOSE_CAP)
        setItems(shown.map(r =>
          "label" in r
            ? { id: r.id, title: r.label, detail: `since ${dayText(r.start_date)}` }
            : { id: r.id, title: r.medication_name, detail: whenText(r.recorded_at) }))
      })
      .catch(() => { if (!cancelled) setItems([]) })
    return () => { cancelled = true }
  }, [personId, kind, recordedAtIso, startIso, endIso])

  // A selection that is no longer offered (the date changed) is dropped.
  const offeredIds = items.map(i => i.id).join(",")
  useEffect(() => {
    const offered = new Set(items.map(i => i.id))
    if (selected.some(id => !offered.has(id))) onChange(selected.filter(id => offered.has(id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to the offered list only
  }, [offeredIds])

  if (items.length === 0) return null

  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
  const noun = kind === "dose" ? "symptom" : "dose"

  // One symptom on a dose form: a single toggle chip, no expanding.
  if (kind === "dose" && items.length === 1) {
    const only = items[0]
    return (
      <div>
        <Chip kind="toggle" pressed={selected.includes(only.id)} onPressedChange={() => toggle(only.id)}>
          For symptom: {only.title} ({only.detail})
        </Chip>
      </div>
    )
  }

  const heading = kind === "dose" ? "Is this for a symptom?" : "Were any doses given for this?"
  return (
    <div className="fc-form">
      <div>
        <Chip
          kind="disclosure"
          expanded={open}
          onExpandedChange={setOpen}
          emoji={kind === "dose" ? "🤒" : "💊"}
        >
          {heading}{selected.length > 0 ? ` ${selected.length} linked` : ""}
        </Chip>
      </div>
      {open && (
        <ul className="fc-suggest-list" aria-label={`${noun}s to link`}>
          {items.map(i => (
            <li key={i.id}>
              <Chip kind="toggle" pressed={selected.includes(i.id)} onPressedChange={() => toggle(i.id)}>
                {i.title} · {i.detail}
              </Chip>
            </li>
          ))}
          {hasMore && <li className="fc-field__hint">Earlier doses can be linked from Edit Symptom.</li>}
        </ul>
      )}
    </div>
  )
}
