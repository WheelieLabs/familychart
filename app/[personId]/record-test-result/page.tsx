// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import AttachmentLink from "@/components/AttachmentViewer"
import CollapsibleNotes from "@/components/CollapsibleNotes"
import RecordShell, { RecordLoading } from "@/components/RecordShell"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import { FileInput, Input } from "@/components/ui/controls"
import DateEcho from "@/components/ui/DateEcho"
import FormField from "@/components/ui/FormField"
import { markAppLockSuppressed } from "@/lib/app-lock-navigation"
import { formatDate } from "@/lib/date-format"
import { instantToZonedYmdHm, zonedTodayYmd } from "@/lib/datetime"
import { announce } from "@/lib/announce"
import { reportProblem } from "@/lib/ui/form-errors"
import { setSaveFlash } from "@/lib/ui/save-flash"
import { isFutureTestDate, testDateToStoredIso } from "@/lib/test-results/test-date"
import { isPdfUrl, withoutExistingMetrics } from "@/lib/test-results/pdf-prefill/rescan"
import type { Person, TestMetricConfig } from "@/lib/domain-types"
import type { TestResultSummary } from "@/lib/test-results/test-result-history"
import MetricPicker from "./MetricPicker"
import PrefillReview from "./PrefillReview"
import ValueRow from "./ValueRow"
import { usePdfPrefill } from "./use-pdf-prefill"
import RedactionReview from "./RedactionReview"
import { draftFromCatalogue, draftFromOther, newRowId, type ValueDraft } from "./value-draft"

type Step = "report" | "values"

export default function RecordTestResultPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const personId = params.personId as string
  const editId = searchParams.get("edit")

  const [person, setPerson] = useState<Person | null>(null)
  const [metricConfigs, setMetricConfigs] = useState<TestMetricConfig[] | null>(null)
  const [history, setHistory] = useState<TestResultSummary[]>([])
  const [loadingExisting, setLoadingExisting] = useState(editId != null)

  const [step, setStep] = useState<Step>("report")

  // Retrospective record: the test date starts empty (results usually arrive days after the test)
  // and no time is asked for.
  const [testDate, setTestDate] = useState("")
  const [name, setName] = useState("")
  const [orderedBy, setOrderedBy] = useState("")
  const [notes, setNotes] = useState("")

  // `file` is what was chosen: read on the phone for prefill and never uploaded. `redacted` is the checked
  // copy with personal details removed, the only thing that is stored.
  const [file, setFile] = useState<File | null>(null)
  const [redacted, setRedacted] = useState<{ file: File; boxes: number } | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [existingAttachmentUrl, setExistingAttachmentUrl] = useState<string | null>(null)
  const [existingTestType, setExistingTestType] = useState("")
  const [values, setValues] = useState<ValueDraft[]>([])
  const [picking, setPicking] = useState(false)
  // Values added by hand open for editing; confirmed and saved ones start as a read-only summary.
  const [newRowIds, setNewRowIds] = useState<Set<number>>(() => new Set())
  const [reviewHint, setReviewHint] = useState(false)
  // Rescan reads the stored report again (fetched back as a blob, never re-uploaded). A newly chosen
  // file always takes precedence over it.
  const [rescanBlob, setRescanBlob] = useState<Blob | null>(null)
  const [rescanFetching, setRescanFetching] = useState(false)
  const [rescanError, setRescanError] = useState("")
  const [scanCount, setScanCount] = useState(0)
  const prefill = usePdfPrefill(file ?? rescanBlob)
  const rescanMode = file === null && rescanBlob !== null
  // Only what is not already on the result is offered; accepted rows leave the list as they are added.
  const rescanRows = useMemo(
    () => (rescanMode && prefill.status === "ready" ? withoutExistingMetrics(prefill.rows, metricConfigs ?? [], values) : []),
    [rescanMode, prefill, metricConfigs, values],
  )

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [fieldErr, setFieldErr] = useState<{ id: string; message: string } | null>(null)

  useEffect(() => {
    fetch(`/api/people/${personId}`).then(r => r.json()).then(setPerson)
  }, [personId])

  useEffect(() => {
    fetch("/api/test-metric-config")
      .then(r => (r.ok ? r.json() : []))
      .then((rows: TestMetricConfig[]) => setMetricConfigs(rows.filter(r => r.is_active === 1)))
      .catch(() => setMetricConfigs([]))
  }, [])

  // Past results feed the Ordered By suggestions and the picker's recent metrics; in edit mode the
  // same fetch supplies the record being edited. Waits for metricConfigs so each existing value
  // can be classified catalogue-vs-other on load.
  useEffect(() => {
    if (metricConfigs === null) return
    fetch(`/api/test-events?person_id=${personId}`)
      .then(r => (r.ok ? r.json() : []))
      .then((events: TestResultSummary[]) => {
        setHistory(events)
        const existing = editId ? events.find(e => String(e.id) === editId) : undefined
        if (!existing) return
        setTestDate(instantToZonedYmdHm(existing.date).date)
        setName(existing.name)
        setExistingTestType(existing.test_type)
        setOrderedBy(existing.ordered_by ?? "")
        setNotes(existing.notes ?? "")
        setExistingAttachmentUrl(existing.attachment_url)
        setValues(existing.values.map(v => {
          const config = metricConfigs.find(c => c.metric_name.toLowerCase() === v.metric_name.toLowerCase())
          return {
            rowId: newRowId(),
            metric_name: config?.metric_name ?? v.metric_name,
            isOther: !config,
            value_type: v.value_type,
            limit_qualifier: v.limit_qualifier ?? "",
            numeric_value: v.numeric_value != null ? String(v.numeric_value) : "",
            qualitative_value: v.qualitative_value ?? "",
            unit: v.unit ?? "",
            reference_range: v.reference_range ?? "",
            flagged: v.flag != null,
          }
        }))
      })
      .finally(() => setLoadingExisting(false))
  }, [editId, personId, metricConfigs])

  const orderedBySuggestions = useMemo(() => {
    const seen = new Set<string>()
    for (const e of history) if (e.ordered_by) seen.add(e.ordered_by)
    return [...seen]
  }, [history])

  function addByHand(draft: ValueDraft) {
    setValues(v => [...v, draft])
    setNewRowIds(ids => new Set(ids).add(draft.rowId))
  }

  const foundCount = rescanMode ? rescanRows.length : prefill.status === "ready" ? prefill.rows.length : 0
  const futureDate = isFutureTestDate(testDate)
  const canContinue = name.trim() !== "" && testDate !== "" && !futureDate

  async function rescanStoredReport() {
    if (!existingAttachmentUrl || rescanFetching) return
    setRescanFetching(true); setRescanError(""); setReviewHint(false)
    try {
      const res = await fetch(existingAttachmentUrl)
      if (!res.ok) throw new Error("fetch failed")
      setRescanBlob(await res.blob())
      setScanCount(n => n + 1)
    } catch {
      setRescanBlob(null)
      setRescanError("Could not open the stored report. You can still add values by hand.")
    } finally {
      setRescanFetching(false)
    }
  }

  function updateValueRow(rowId: number, patch: Partial<ValueDraft>) {
    setValues(v => v.map(row => (row.rowId === rowId ? { ...row, ...patch } : row)))
  }

  function removeValueRow(rowId: number) {
    setValues(v => v.filter(row => row.rowId !== rowId))
  }

  /** One validation problem: show it, mark the field, focus it and announce it. */
  function fail(message: string, fieldId: string, fieldLabel: string) {
    setFieldErr({ id: fieldId, message })
    setSaving(false)
    reportProblem(fieldId, fieldLabel)
  }

  /** The report step's own checks. Returns true when the name and test date are fine. */
  function reportStepIsValid(): boolean {
    setFieldErr(null)
    if (!name.trim()) { fail("Enter a name for the test.", "test-name", "Name"); return false }
    if (!testDate) { fail("Enter the test date.", "test-date", "Test date"); return false }
    if (futureDate) { fail("The test date cannot be in the future.", "test-date", "Test date"); return false }
    return true
  }

  async function handleSave(withValues: boolean) {
    setSaving(true); setError("")
    try {
      if (!reportStepIsValid()) return

      const savedValues = withValues ? values : []
      for (const v of savedValues) {
        if (v.isOther && !v.metric_name.trim()) {
          setError("Please name each custom metric, or remove the row.")
          setSaving(false)
          announce("1 problem to fix. First: custom metric name.", "assertive")
          return
        }
        const missing = v.value_type === "numeric" ? v.numeric_value.trim() === "" : v.qualitative_value.trim() === ""
        if (missing) {
          setError(`Enter a value for ${v.metric_name || "each row"}, or remove the row.`)
          setSaving(false)
          announce(`1 problem to fix. First: ${v.metric_name || "a value"}.`, "assertive")
          return
        }
      }

      let attachmentUrl: string | null = existingAttachmentUrl
      if (file) {
        if (!redacted) {
          setError("Check the report for personal details before saving (go back to the report step).")
          setSaving(false)
          return
        }
        const form = new FormData()
        form.append("file", redacted.file)
        form.append("person_id", personId)
        const uploadRes = await fetch("/api/test-results/upload", { method: "POST", body: form })
        if (!uploadRes.ok) {
          const body = await uploadRes.json().catch(() => ({}))
          setError(body.error || "Failed to upload attachment.")
          setSaving(false)
          return
        }
        attachmentUrl = (await uploadRes.json()).url
      }

      const payloadValues = savedValues.map(v => ({
        metric_name: v.metric_name.trim(),
        other: v.isOther,
        value_type: v.value_type,
        numeric_value: v.value_type === "numeric" ? parseFloat(v.numeric_value) : undefined,
        qualitative_value: v.value_type === "qualitative" ? v.qualitative_value : undefined,
        limit_qualifier: v.value_type === "numeric" && v.limit_qualifier ? v.limit_qualifier : undefined,
        unit: v.unit || undefined,
        reference_range: v.reference_range || undefined,
        flag: v.flagged ? "differs from expected" : undefined,
      }))

      const payload = {
        person_id: parseInt(personId),
        // The separate Test Type field is gone; an edited record keeps whatever it already had.
        test_type: existingTestType || null,
        name: name.trim(),
        date: testDateToStoredIso(testDate),
        ordered_by: orderedBy.trim() || null,
        notes: notes.trim() || null,
        attachment_url: attachmentUrl,
        values: payloadValues,
      }

      const res = await fetch(editId ? `/api/test-events?id=${editId}` : "/api/test-events", {
        method: editId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || "Failed to save. Please try again.")
        setSaving(false)
        return
      }
      // An edit is opened from History: go back to the exact view it came from (a drill-down keeps its place).
      if (editId && window.history.length > 1) router.back()
      else {
        setSaveFlash(`${name.trim()} test result`)
        router.push(`/${personId}`)
      }
    } catch {
      setError("Failed to save. Please try again.")
      setSaving(false)
    }
  }

  const title = editId ? "Edit Test Result" : "Record Test Result"
  if (!person || metricConfigs === null || loadingExisting) return <RecordLoading title={title} />

  return (
    <RecordShell title={title} person={person}>
      <div className="fc-form">
        <p className="fc-section-copy" aria-live="polite">
          <strong>Step {step === "report" ? "1" : "2"} of 2</strong> · {step === "report" ? "Report" : "Values"}
        </p>

        {step === "report" ? (
          <>
            <FormField
              id="test-name"
              label="Name"
              error={fieldErr?.id === "test-name" ? fieldErr.message : undefined}
            >
              <Input type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. Iron Studies, TFT Master Panel" />
            </FormField>

            <FormField label="Report" optional hint="PDF, JPEG, PNG or WebP, up to 20 MB">
              {existingAttachmentUrl && !file && (
                <p className="fc-section-copy">
                  Current: <AttachmentLink url={existingAttachmentUrl} />
                  {" "}— choose a file below to replace it.
                  {isPdfUrl(existingAttachmentUrl) && (
                    <>
                      {" "}
                      <Button variant="quiet" onClick={() => void rescanStoredReport()} pending={rescanFetching} pendingLabel="Opening report…">
                        Rescan report
                      </Button>
                    </>
                  )}
                </p>
              )}
              {rescanError && <Banner kind="error">{rescanError}</Banner>}
              <FileInput
                accept="application/pdf,image/jpeg,image/png,image/webp"
                file={file}
                onBeforeChoose={() => markAppLockSuppressed(sessionStorage)}
                onFileChange={chosen => {
                  setFile(chosen); setRedacted(null); setReviewing(chosen !== null)
                  setRescanBlob(null); setRescanError(""); setReviewHint(false)
                }}
              />
              {file && (
                <p className="fc-section-copy" role="status">
                  {redacted ? (
                    <>
                      ✓ Checked for personal details ({redacted.boxes === 0 ? "nothing removed" : `${redacted.boxes} removed`}).{" "}
                      <Button variant="quiet" onClick={() => setReviewing(true)}>Review again</Button>
                    </>
                  ) : (
                    <>
                      This report must be checked for personal details before it can be saved.{" "}
                      <Button variant="quiet" onClick={() => setReviewing(true)}>Check report</Button>
                    </>
                  )}
                </p>
              )}
              {reviewing && file && (
                <RedactionReview
                  file={file}
                  onCancel={() => setReviewing(false)}
                  onDone={(checked, boxes) => { setRedacted({ file: checked, boxes }); setReviewing(false) }}
                />
              )}
              {prefill.status === "reading" && <p className="fc-field__hint" aria-live="polite">Reading report…</p>}
              {prefill.status === "ready" && (!rescanMode || rescanRows.length > 0) && (
                <div className="fc-subform" role="status">
                  <div>
                    <Button
                      variant="secondary"
                      onClick={() => { if (canContinue) setStep("values"); else setReviewHint(true) }}
                    >
                      Found {foundCount} {rescanMode ? "new " : ""}value{foundCount === 1 ? "" : "s"} in this report. Review ›
                    </Button>
                  </div>
                  {reviewHint && !canContinue && (
                    <p className="fc-field__hint">Enter a name and test date first, then review.</p>
                  )}
                  {prefill.meta.collectedYmd && testDate === "" && !isFutureTestDate(prefill.meta.collectedYmd) && (
                    <div>
                      <Button variant="quiet" onClick={() => setTestDate(prefill.meta.collectedYmd!)}>
                        Use collection date {formatDate(prefill.meta.collectedYmd)} as the test date
                      </Button>
                    </div>
                  )}
                  {prefill.meta.title && name.trim() === "" && (
                    <div>
                      <Button variant="quiet" onClick={() => setName(prefill.meta.title!)}>
                        Use “{prefill.meta.title}” as the name
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {rescanMode && !rescanFetching && prefill.status === "ready" && rescanRows.length === 0 && (
                <p className="fc-field__hint" role="status">No new values found in this report.</p>
              )}
              {rescanMode && prefill.status === "none" && (
                <p className="fc-field__hint" role="status">
                  {prefill.failed
                    ? "Could not read this report. You can still add values by hand."
                    : "No new values found in this report."}
                </p>
              )}
            </FormField>

            <FormField
              id="test-date"
              label="Test date"
              hint="The day the test was taken. Use the date you received the report if that is all you have."
              error={
                fieldErr?.id === "test-date" ? fieldErr.message
                  : futureDate ? "The test date cannot be in the future." : undefined
              }
            >
              <Input type="date" value={testDate} max={zonedTodayYmd()} onChange={e => setTestDate(e.target.value)} />
              <DateEcho date={testDate} />
            </FormField>

            <FormField label="Ordered by" optional>
              <Input type="text" value={orderedBy} onChange={e => setOrderedBy(e.target.value)} list="test-ordered-by-list" />
              <datalist id="test-ordered-by-list">
                {orderedBySuggestions.map(o => <option key={o} value={o} />)}
              </datalist>
            </FormField>

            <CollapsibleNotes noun="notes" value={notes} onChange={setNotes} />

            {error && <Banner kind="error">{error}</Banner>}

            <div className="fc-actions-end">
              <Button variant="secondary" onClick={() => handleSave(false)} pending={saving}>Save without values</Button>
              <Button onClick={() => { setError(""); if (reportStepIsValid()) setStep("values") }}>Next: values</Button>
            </div>
          </>
        ) : (
          <>
            <p className="fc-section-copy">
              <strong>{name.trim()}</strong> · {testDate ? formatDate(testDate) : ""}{" "}
              <Button variant="quiet" onClick={() => setStep("report")}>Edit</Button>
            </p>

            {prefill.status === "ready" && (
              <PrefillReview key={scanCount} pdf={prefill.pdf} rows={rescanMode ? rescanRows : prefill.rows} configs={metricConfigs}
                onAdd={draft => setValues(v => [...v, draft])} />
            )}

            <div className="fc-form">
              {values.length === 0 && !picking && prefill.status !== "ready" && (
                <p className="fc-field__hint">
                  Add the headline values from the report (typically 1 to 5). The attachment stays the source of truth.
                </p>
              )}
              {values.map(v => (
                <ValueRow key={v.rowId} draft={v} startEditing={newRowIds.has(v.rowId)}
                  onChange={patch => updateValueRow(v.rowId, patch)}
                  onRemove={() => removeValueRow(v.rowId)} />
              ))}

              {picking ? (
                <MetricPicker configs={metricConfigs} history={history}
                  onPickCatalogue={config => { addByHand(draftFromCatalogue(config)); setPicking(false) }}
                  onPickOther={metricName => { addByHand(draftFromOther(metricName)); setPicking(false) }}
                  onCancel={() => setPicking(false)} />
              ) : (
                <div>
                  <Button variant="secondary" onClick={() => setPicking(true)}>+ Add value</Button>
                </div>
              )}
            </div>

            {error && <Banner kind="error">{error}</Banner>}

            <div className="fc-actions-end">
              <Button variant="secondary" onClick={() => setStep("report")}>Back</Button>
              <Button onClick={() => handleSave(true)} pending={saving}>Save</Button>
            </div>
          </>
        )}
      </div>
    </RecordShell>
  )
}
