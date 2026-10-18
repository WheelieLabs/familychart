// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useMemo, useState } from "react"
import Button from "@/components/ui/Button"
import Chip from "@/components/ui/Chip"
import Surface from "@/components/ui/Surface"
import { formatDateShort, formatTime, formatWeekdayDate } from "@/lib/date-format"
import { dashboardScheduleHeaders } from "@/lib/dashboard/dashboard-client-context"
import {
  EMPTY_LINK_DELTA,
  effectiveLinkedIds,
  groupByLocalDay,
  isEmptyDelta,
  pickToLink,
  removeLinked,
  undoRemove,
  type LinkDelta,
} from "@/lib/symptoms/link-editing"
import type { LinkDose, LinkSymptom } from "@/lib/symptoms/symptom-dose-link-types"

type Props = {
  personId: string | number
  /** Pending changes are reported here; the parent applies them with {@link saveLinkDelta} once its own save succeeds. */
  onChange: (delta: LinkDelta) => void
  /** Use on a dark background (History) rather than the light form panel. */
  tone?: "light" | "dark"
} & (
  | { kind: "symptom"; symptomId: number }
  | { kind: "dose"; recordId: number; /** Current dose time (ISO) in the edit form. */ recordedAtIso: string }
)

interface Item { id: number; title: string; detail: string; iso: string }

const dayLabel = (ymd: string) => formatWeekdayDate(ymd)

function toItem(r: LinkSymptom | LinkDose): Item {
  return "label" in r
    ? { id: r.id, title: r.label, detail: `since ${formatDateShort(r.start_date)}`, iso: r.start_date }
    : {
        id: r.id,
        title: r.medication_name,
        detail: formatTime(r.recorded_at),
        iso: r.recorded_at,
      }
}

/** Sends the pending link changes for one record. Resolves false when the server refused them. */
export async function saveLinkDelta(
  personId: string | number,
  target: { symptomId: number } | { recordId: number },
  delta: LinkDelta,
): Promise<boolean> {
  if (isEmptyDelta(delta)) return true
  const body = "symptomId" in target
    ? { symptom_id: target.symptomId, add_record_ids: delta.add, remove_record_ids: delta.remove }
    : { record_id: target.recordId, add_symptom_ids: delta.add, remove_symptom_ids: delta.remove }
  const res = await fetch("/api/symptom-dose-links", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ person_id: Number(personId), ...body }),
  })
  return res.ok
}

/**
 * Edit-screen control for a record's links: the linked items with a per-row remove and an undo
 * strip, and "Add linked …" opening an uncapped picker (doses grouped by day, newest first).
 * Nothing is sent until the parent calls {@link saveLinkDelta}.
 */
export default function LinkedItemsEditor(props: Props) {
  const { personId, onChange, tone = "light" } = props
  const [linked, setLinked] = useState<Item[]>([])
  const [candidates, setCandidates] = useState<Item[]>([])
  const [delta, setDelta] = useState<LinkDelta>(EMPTY_LINK_DELTA)
  const [picking, setPicking] = useState(false)

  const isSymptomSide = props.kind === "symptom"
  const targetId = props.kind === "symptom" ? props.symptomId : props.recordId
  const recordedAtIso = props.kind === "dose" ? props.recordedAtIso : ""
  const noun = isSymptomSide ? "dose" : "symptom"

  useEffect(() => {
    let cancelled = false
    const get = (qs: URLSearchParams) =>
      fetch(`/api/symptom-dose-links?${qs}`, { cache: "no-store", headers: dashboardScheduleHeaders() })
        .then(r => (r.ok ? (r.json() as Promise<(LinkSymptom | LinkDose)[]>) : []))
    const base = { person_id: String(personId) }
    const linkedQs = new URLSearchParams(isSymptomSide ? { ...base, symptom_id: String(targetId) } : { ...base, record_id: String(targetId) })
    const candQs = new URLSearchParams(
      isSymptomSide
        ? { ...base, candidates: "doses", symptom_id: String(targetId) }
        : { ...base, candidates: "symptoms", recorded_at: recordedAtIso },
    )
    Promise.all([get(linkedQs), get(candQs)]).then(([l, c]) => {
      if (cancelled) return
      setLinked(l.map(toItem))
      setCandidates(c.map(toItem))
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [personId, isSymptomSide, targetId, recordedAtIso])

  function update(next: LinkDelta) {
    setDelta(next)
    onChange(next)
  }

  const byId = useMemo(() => new Map([...linked, ...candidates].map(i => [i.id, i])), [linked, candidates])
  const linkedIds = linked.map(i => i.id)
  const shownIds = effectiveLinkedIds(linkedIds, delta)
  const shown = shownIds.map(id => byId.get(id)).filter((i): i is Item => i !== undefined)
  const pickable = candidates.filter(c => !shownIds.includes(c.id))

  if (linked.length === 0 && candidates.length === 0) return null

  return (
    <Surface kind={tone} className="fc-linked-editor">
      <div className="fc-linked-editor__title">Linked {noun}s</div>
      {shown.length === 0 && <p className="fc-linked-editor__muted">None linked.</p>}
      <ul className="fc-linked-editor__list">
        {shown.map(i => (
          <li key={i.id} className="fc-linked-editor__row">
            <span>
              <span className="fc-linked-editor__strong">{i.title}</span>{" "}
              <span className="fc-linked-editor__muted">· {isSymptomSide ? `${formatDateShort(i.iso)} ${i.detail}` : i.detail}</span>
            </span>
            <Button variant="quiet" aria-label={`Remove link to ${i.title}`}
              onClick={() => update(removeLinked(delta, i.id))}>Remove</Button>
          </li>
        ))}
      </ul>
      {delta.remove.map(id => byId.get(id)).filter((i): i is Item => i !== undefined).map(i => (
        <div key={i.id} role="status" className="fc-linked-editor__row">
          <span>Unlinked {i.title}. Applied when you save.</span>
          <Button variant="quiet" onClick={() => update(undoRemove(delta, i.id))}>Undo</Button>
        </div>
      ))}
      {pickable.length > 0 && (
        <div>
          <Chip kind="disclosure" expanded={picking} onExpandedChange={setPicking}>
            {picking ? "Done adding" : `Add linked ${noun}s`}
          </Chip>
        </div>
      )}
      {picking && (
        <div className="fc-linked-editor__list" role="group" aria-label={`${noun}s that can be linked`}>
          {(isSymptomSide
            ? groupByLocalDay(pickable, i => i.iso)
            : [{ day: "", items: pickable }]
          ).map(g => (
            <div key={g.day || "all"}>
              {g.day && <div className="fc-linked-editor__muted">{dayLabel(g.day)}</div>}
              <ul className="fc-linked-editor__list">
                {g.items.map(i => (
                  <li key={i.id}>
                    <Button variant="secondary" onClick={() => update(pickToLink(delta, i.id, linkedIds))}>
                      ＋ {i.title} · {i.detail}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Surface>
  )
}
