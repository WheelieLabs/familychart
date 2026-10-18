// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import CollapsibleNotes from "@/components/CollapsibleNotes"
import SymptomDoseLinkField from "@/components/SymptomDoseLinkField"
import LinkedItemsEditor, { saveLinkDelta } from "@/components/LinkedItemsEditor"
import { EMPTY_LINK_DELTA, type LinkDelta } from "@/lib/symptoms/link-editing"
import RecordShell, { RecordLoading } from "@/components/RecordShell"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import { Checkbox, Input } from "@/components/ui/controls"
import DateEcho from "@/components/ui/DateEcho"
import FormField from "@/components/ui/FormField"
import SeveritySlider from "@/components/ui/SeveritySlider"
import { instantToZonedYmdHm, localDateAndTimeToUtcIso, zonedTodayYmd } from "@/lib/datetime"
import { reportProblem } from "@/lib/ui/form-errors"
import { setSaveFlash } from "@/lib/ui/save-flash"
import type { Person } from "@/lib/domain-types"
import type { SymptomEventSummary } from "@/lib/symptoms/symptom-history"

export default function RecordSymptomPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const personId = params.personId as string
  const editId = searchParams.get("edit")

  const [person, setPerson] = useState<Person | null>(null)
  const [labels, setLabels] = useState<string[] | null>(null)
  const [loadingExisting, setLoadingExisting] = useState(editId != null)

  const [label, setLabel] = useState("")
  const [startDate, setStartDate] = useState(() => zonedTodayYmd())
  const [hasEndDate, setHasEndDate] = useState(false)
  const [endDate, setEndDate] = useState(() => zonedTodayYmd())
  const [severity, setSeverity] = useState(1)
  const [isResolved, setIsResolved] = useState(false)
  const [notes, setNotes] = useState("")
  const [linkedRecordIds, setLinkedRecordIds] = useState<number[]>([])
  const [linkDelta, setLinkDelta] = useState<LinkDelta>(EMPTY_LINK_DELTA)

  // Doses are offered across the span being entered, so changing the dates refetches them.
  const linkSpan = useMemo(() => {
    try {
      return {
        startIso: localDateAndTimeToUtcIso(startDate, "00:00"),
        endIso: hasEndDate ? localDateAndTimeToUtcIso(endDate, "00:00") : null,
      }
    } catch {
      return null
    }
  }, [startDate, hasEndDate, endDate])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [labelInvalid, setLabelInvalid] = useState(false)

  useEffect(() => {
    fetch(`/api/people/${personId}`).then(r => r.json()).then(setPerson)
  }, [personId])

  useEffect(() => {
    fetch(`/api/symptom-events/labels?person_id=${personId}`)
      .then(r => (r.ok ? r.json() : []))
      .then((rows: string[]) => setLabels(rows))
      .catch(() => setLabels([]))
  }, [personId])

  useEffect(() => {
    if (!editId) return
    fetch(`/api/symptom-events?person_id=${personId}`)
      .then(r => (r.ok ? r.json() : []))
      .then((events: SymptomEventSummary[]) => {
        const existing = events.find(e => String(e.id) === editId)
        if (!existing) return
        setLabel(existing.label)
        setStartDate(instantToZonedYmdHm(existing.start_date).date)
        if (existing.end_date) {
          setHasEndDate(true)
          setEndDate(instantToZonedYmdHm(existing.end_date).date)
        }
        setSeverity(existing.severity)
        setIsResolved(existing.is_resolved)
        setNotes(existing.notes ?? "")
      })
      .finally(() => setLoadingExisting(false))
  }, [editId, personId])

  async function handleSave() {
    setSaving(true); setError(""); setLabelInvalid(false)
    try {
      if (!label.trim()) {
        setLabelInvalid(true)
        setSaving(false)
        reportProblem("symptom-label", "Symptom")
        return
      }

      const payload = {
        person_id: parseInt(personId),
        label: label.trim(),
        start_date: localDateAndTimeToUtcIso(startDate, "00:00"),
        end_date: hasEndDate ? localDateAndTimeToUtcIso(endDate, "00:00") : null,
        severity,
        is_resolved: isResolved,
        notes: notes.trim() || null,
        ...(!editId && linkedRecordIds.length > 0 ? { linked_record_ids: linkedRecordIds } : {}),
      }

      const res = editId
        ? await fetch(`/api/symptom-events?id=${editId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/symptom-events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || "Failed to save. Please try again.")
        setSaving(false)
        return
      }
      if (editId) {
        const linked = await saveLinkDelta(personId, { symptomId: parseInt(editId, 10) }, linkDelta)
        if (!linked) {
          setError("Saved, but the linked doses could not be updated. Please try again.")
          setSaving(false)
          return
        }
      }
      // An edit is opened from History: go back to the exact view it came from (a drill-down keeps its place).
      if (editId && window.history.length > 1) router.back()
      else {
        setSaveFlash(label.trim())
        router.push(`/${personId}`)
      }
    } catch {
      setError("Failed to save. Please try again.")
      setSaving(false)
    }
  }

  if (!person || labels === null || loadingExisting) return <RecordLoading title={editId ? "Edit Symptom" : "Record Symptom"} />

  return (
    <RecordShell title={editId ? "Edit Symptom" : "Record Symptom"} person={person}>
      <div className="fc-form">
        <FormField
          id="symptom-label"
          label="Symptom"
          error={labelInvalid ? "Enter a description of the symptom." : undefined}
        >
          <Input type="text" value={label} onChange={e => setLabel(e.target.value)}
            placeholder="e.g. Runny nose" list="symptom-label-list" />
          <datalist id="symptom-label-list">
            {labels.map(l => <option key={l} value={l} />)}
          </datalist>
        </FormField>

        <FormField label="Start date">
          <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          <DateEcho date={startDate} />
        </FormField>

        <Checkbox label="Has an end date" checked={hasEndDate} onChange={e => setHasEndDate(e.target.checked)} />
        {hasEndDate && (
          <FormField label="End date">
            <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            <DateEcho date={endDate} />
          </FormField>
        )}

        <FormField label="Severity">
          <SeveritySlider value={severity} onChange={setSeverity} />
        </FormField>

        <Checkbox label="Mark as resolved" checked={isResolved} onChange={e => setIsResolved(e.target.checked)} />

        {editId ? (
          <LinkedItemsEditor kind="symptom" personId={personId} symptomId={parseInt(editId, 10)} onChange={setLinkDelta} />
        ) : (
          linkSpan && (
            <SymptomDoseLinkField
              kind="symptom"
              personId={personId}
              startIso={linkSpan.startIso}
              endIso={linkSpan.endIso}
              selected={linkedRecordIds}
              onChange={setLinkedRecordIds}
            />
          )
        )}

        <CollapsibleNotes noun="notes" value={notes} onChange={setNotes} />

        {error && <Banner kind="error">{error}</Banner>}

        <div className="fc-actions-end">
          <Button onClick={handleSave} pending={saving}>Save</Button>
        </div>
      </div>
    </RecordShell>
  )
}
