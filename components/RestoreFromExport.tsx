// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react"
import { HOUSEHOLD_ROLE_OPTIONS } from "@/lib/account/account-role-labels"
import { announce } from "@/lib/announce"
import { formatDobWithAge } from "@/lib/date-format"
import { getSettingUiMeta } from "@/lib/settings/ui-metadata"
import { focusFirstInvalid } from "@/lib/ui/form-errors"
import { disabledWhen } from "@/lib/ui/disabled-props"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import { ChipGroup } from "@/components/ui/Chip"
import EmptyState, { EMPTY_STATE_ICONS } from "@/components/ui/EmptyState"
import FormField, { FieldRow } from "@/components/ui/FormField"
import ListCard, { CardList } from "@/components/ui/ListCard"
import Panel from "@/components/ui/Panel"
import { Checkbox, FileInput, Input, Select } from "@/components/ui/controls"

/** Same width as Import Records: restore needs a desktop browser below 1024px. */
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const read = () => setNarrow(window.innerWidth < 1024)
    read()
    window.addEventListener("resize", read)
    return () => window.removeEventListener("resize", read)
  }, [])
  return narrow
}

type PersonAction = "new" | "map" | "skip"
type MedicationAction = "new" | "map"

interface PlanPerson {
  bundle_id: number
  name: string
  date_of_birth: string | null
  suggested_action: PersonAction
  target_id: number | null
}

interface PlanMedication {
  bundle_id: number
  name: string
  suggested_action: MedicationAction
  target_id: number | null
}

interface Difference {
  kind: string
  medication?: string
  person?: string
  observation_type?: string
  test_name?: string
  metric?: string
  field: string
  existing: unknown
  export: unknown
}

interface PlanWarning {
  kind: string
  path?: string
  reason?: string
  catalogue?: string
  name?: string
}

interface PlanAccount {
  bundle_id: number
  email: string
  role: string
  role_needs_choice?: boolean
  person_name: string | null
  included: boolean
  skip_reason: string | null
  method_change_note: string | null
  note: string | null
}

type AccountsSection =
  | "not restored"
  | { status: "skipped_preflight"; message: string; items: PlanAccount[] }
  | { status: "ready"; items: PlanAccount[] }

interface AccountsApplyResult {
  status: string
  message?: string
  invites_created?: number
  invites_skipped?: number
  emails_sent?: number
  emails_failed?: number
}

interface FavouritesReport {
  created: number
  duplicates: number
  not_restored: { reason: string; count: number }[]
  added_to_existing?: { email: string; count: number }[]
}

interface SettingsDifference {
  key: string
  label: string
  existing: string
  export: string
  reason: "kept" | "locked"
}

interface SettingsReport {
  applied: { key: string; value: string }[]
  differences: SettingsDifference[]
  skipped: { key: string; reason: string }[]
  per_user: "not restored"
}

interface UserSettingsReport {
  lines: string[]
}

interface RestorePlan {
  scope?: "person" | "household"
  format_version?: number
  persons: PlanPerson[]
  medications: PlanMedication[]
  differences: Difference[]
  warnings: PlanWarning[]
  counts: { new: number; duplicate: number; differing: number; skipped: number }
  created: Record<string, number>
  duplicates: Record<string, number>
  skipped_unknown: { catalogue: string; name: string; count: number }[]
  mapped: { persons: number; medications: number }
  accounts: AccountsSection
  accounts_result?: AccountsApplyResult
  favourites: FavouritesReport | "not restored"
  settings: SettingsReport | "not restored"
  user_settings?: UserSettingsReport | "not restored"
}

interface ExistingPerson {
  id: number
  name: string
  date_of_birth: string | null
  is_active: number
}

interface ExistingMedication {
  id: number
  name: string
  is_active: number
}

interface Choice {
  bundle_id: number
  action: PersonAction | MedicationAction
  target_id: number | null
}

interface SignInChoice {
  bundle_id: number
  email: string
  role: string
}

const SIGN_IN_ROLES = [
  ...HOUSEHOLD_ROLE_OPTIONS.filter(role => role.value === "none"),
  ...[...HOUSEHOLD_ROLE_OPTIONS].filter(role => role.value !== "none").reverse(),
]

type RestoreStep = "people" | "medications" | "accounts" | "review"

const STEP_TITLES: Record<RestoreStep, string> = {
  people: "People",
  medications: "Medications",
  accounts: "Accounts",
  review: "Review and apply",
}

function stepsFor(plan: RestorePlan): RestoreStep[] {
  const steps: RestoreStep[] = ["people"]
  if (plan.medications.length > 0) steps.push("medications")
  if (plan.accounts !== "not restored" && plan.accounts.items.length > 0) steps.push("accounts")
  steps.push("review")
  return steps
}

/** Step 1 is choosing the file, so the first step after the preview opens is step 2. */
function StepHeader({ headingRef, index, total, title }: {
  headingRef: RefObject<HTMLHeadingElement | null>
  index: number
  total: number
  title: string
}) {
  return (
    <h3 ref={headingRef} tabIndex={-1} className="fc-section-title">
      {`Step ${index + 1} of ${total}: ${title}`}
    </h3>
  )
}

function wantsPersonSignIn(plan: RestorePlan): boolean {
  return plan.scope === "person" && (plan.format_version ?? 0) >= 2
}

function isSignInEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

const PERSON_OPTIONS = [
  { value: "new" as const, label: "New" },
  { value: "map" as const, label: "Map to existing" },
  { value: "skip" as const, label: "Skip" },
]

const MEDICATION_OPTIONS = [
  { value: "new" as const, label: "New" },
  { value: "map" as const, label: "Map to existing" },
]

const FIELD_WORDS: Record<string, string> = {
  count: "number of rules",
  min_hours_between: "minimum hours between doses",
  max_hours_between: "maximum hours between doses",
  max_quantity_per_24h: "maximum quantity in 24 hours",
  schedule_times: "schedule times",
  target_value: "target",
  unit: "unit",
}

const COUNT_WORDS: Record<string, [string, string]> = {
  persons: ["person", "people"],
  medications: ["medication", "medications"],
  frequency_rules: ["frequency rule", "frequency rules"],
  assignments: ["assignment", "assignments"],
  administrations: ["dose", "doses"],
  observations: ["observation", "observations"],
  test_results: ["test result", "test results"],
  test_result_values: ["test result value", "test result values"],
  symptoms: ["symptom", "symptoms"],
  symptom_dose_links: ["symptom link", "symptom links"],
  observation_goals: ["observation goal", "observation goals"],
  observation_expectations: ["observation reminder", "observation reminders"],
  dose_expectations: ["dose expectation", "dose expectations"],
  dose_expectation_exceptions: ["dose expectation exception", "dose expectation exceptions"],
  dose_expectation_outcomes: ["dose outcome", "dose outcomes"],
  slot_outcomes: ["slot outcome", "slot outcomes"],
}

function showValue(value: unknown): string {
  if (value == null || value === "") return "nothing"
  return String(value)
}

function differenceText(row: Difference): string {
  const subject = [row.medication, row.person, row.observation_type, row.test_name, row.metric].filter(Boolean).join(", ")
  const field = FIELD_WORDS[row.field] ?? row.field.replaceAll("_", " ")
  const who = subject ? `${subject}, ${field}` : field
  return `${who}: this instance has ${showValue(row.existing)} and the export has ${showValue(row.export)}. This instance is kept.`
}

function counted(n: number, key: string): string {
  const words = COUNT_WORDS[key] ?? [key, key]
  return `${n} ${n === 1 ? words[0] : words[1]}`
}

function linesFor(counts: Record<string, number> | undefined): string[] {
  if (!counts) return []
  return Object.entries(counts).filter(([, n]) => n > 0).map(([key, n]) => counted(n, key))
}

function joinList(items: string[]): string {
  if (items.length === 0) return ""
  if (items.length === 1) return items[0]
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

function accountLines(plan: RestorePlan): string[] {
  const lines: string[] = []
  if (plan.accounts === "not restored") return lines
  const result = plan.accounts_result
  if (result?.status === "skipped_preflight") {
    lines.push(result.message ?? (plan.accounts.status === "skipped_preflight" ? plan.accounts.message : ""))
    lines.push("Set up outbound email in System Settings, then run this restore again to invite Accounts.")
    return lines
  }
  if (result?.status === "applied") {
    const parts: string[] = []
    if (result.invites_created) parts.push(`${result.invites_created} pending invite${result.invites_created === 1 ? "" : "s"} created`)
    if (result.invites_skipped) parts.push(`${result.invites_skipped} skipped`)
    if (parts.length) lines.push(`Accounts: ${parts.join(", ")}.`)
    if (result.emails_failed) {
      lines.push(`${result.emails_failed} invite email${result.emails_failed === 1 ? "" : "s"} could not be sent — use Resend on Administration → Accounts.`)
    }
    return lines
  }
  if (plan.accounts.status === "skipped_preflight") {
    lines.push(plan.accounts.message)
    lines.push("Set up outbound email in System Settings, then run this restore again to invite Accounts.")
  }
  return lines
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function settingDifferenceText(row: SettingsDifference): string {
  return `${row.label}: this instance has ${showValue(row.existing)} and the export has ${showValue(row.export)}. This instance is kept.`
}

function favouriteResultLines(report: FavouritesReport): string[] {
  const lines: string[] = []
  if (report.created) lines.push(`Created ${plural(report.created, "favourite", "favourites")}.`)
  if (report.duplicates) {
    lines.push(`Skipped ${plural(report.duplicates, "favourite", "favourites")} already on this instance.`)
  }
  for (const row of report.added_to_existing ?? []) {
    lines.push(`Added ${plural(row.count, "favourite", "favourites")} to the existing Account ${row.email}.`)
  }
  for (const row of report.not_restored) {
    lines.push(`Did not restore ${plural(row.count, "favourite", "favourites")} (${row.reason}).`)
  }
  return lines
}

function settingsResultLines(report: SettingsReport): string[] {
  const lines = report.applied.map(row => `Applied ${getSettingUiMeta(row.key).label} as ${showValue(row.value)}.`)
  lines.push(...report.differences.map(settingDifferenceText))
  const secrets = report.skipped.filter(row => row.reason === "secret").length
  const locked = report.skipped.filter(row => row.reason === "platform_locked").length
  const signIn = report.skipped.filter(row => row.reason === "sign_in").length
  const other = report.skipped.length - secrets - locked - signIn
  if (secrets) lines.push(`${plural(secrets, "secret setting was", "secret settings were")} not applied.`)
  if (locked) lines.push(`${plural(locked, "locked setting was", "locked settings were")} not applied.`)
  if (signIn) lines.push(`${plural(signIn, "sign-in setting was", "sign-in settings were")} not applied. Set up sign-in under Administration.`)
  if (other) lines.push(`${plural(other, "setting was", "settings were")} not applied.`)
  return lines
}

function namedUserSettings(plan: RestorePlan, preview: boolean): string[] {
  if (plan.user_settings && plan.user_settings !== "not restored") return plan.user_settings.lines
  if (plan.settings !== "not restored" && plan.settings.per_user === "not restored") {
    return [preview ? "Per-user settings will not be restored." : "Per-user settings were not restored."]
  }
  return []
}

function previewNotes(plan: RestorePlan): string[] {
  const lines: string[] = [...accountLines(plan)]
  if (plan.favourites === "not restored") lines.push("Favourites were not restored.")
  else {
    for (const row of plan.favourites.added_to_existing ?? []) {
      lines.push(`${plural(row.count, "favourite", "favourites")} will be added to the existing Account ${row.email}.`)
    }
    for (const row of plan.favourites.not_restored) {
      lines.push(`Will not restore ${plural(row.count, "favourite", "favourites")} (${row.reason}).`)
    }
  }
  if (plan.settings === "not restored") lines.push("Instance settings were not restored.")
  else {
    const secrets = plan.settings.skipped.filter(row => row.reason === "secret").length
    const locked = plan.settings.skipped.filter(row => row.reason === "platform_locked").length
    if (secrets) lines.push("Secrets in the export will not be applied.")
    if (locked) lines.push("Locked settings in the export will not be applied.")
    if (plan.settings.skipped.some(row => row.reason === "sign_in")) {
      lines.push("Sign-in settings in the export will not be applied. Set up sign-in under Administration.")
    }
  }
  lines.push(...namedUserSettings(plan, true))
  return lines
}

function resultNotes(plan: RestorePlan): string[] {
  const lines: string[] = [...accountLines(plan)]
  if (plan.favourites === "not restored") lines.push("Favourites were not restored.")
  else lines.push(...favouriteResultLines(plan.favourites))
  if (plan.settings === "not restored") lines.push("Instance settings were not restored.")
  else lines.push(...settingsResultLines(plan.settings))
  lines.push(...namedUserSettings(plan, false))
  return lines
}

function accountSelectable(item: PlanAccount): boolean {
  return item.skip_reason == null || item.skip_reason === "excluded"
}

function dobText(value: string | null): string {
  if (!value) return "No date of birth"
  return formatDobWithAge(value)
}

/**
 * Upload, preview, mapping and apply for a FamilyChart export.
 * Below 1024px this is the Desktop Required screen; downloads on the page stay available.
 */
export default function RestoreFromExport({ maxUploadMb = 512 }: { maxUploadMb?: number }) {
  const narrow = useNarrowViewport()
  const formRef = useRef<HTMLFormElement>(null)
  const resultRef = useRef<HTMLHeadingElement>(null)
  const stepRef = useRef<HTMLHeadingElement>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [fileError, setFileError] = useState<string | null>(null)
  const [busy, setBusy] = useState<"upload" | "apply" | null>(null)
  const [stagedId, setStagedId] = useState<string | null>(null)
  const [plan, setPlan] = useState<RestorePlan | null>(null)
  const [persons, setPersons] = useState<Choice[]>([])
  const [medications, setMedications] = useState<Choice[]>([])
  const [accounts, setAccounts] = useState<{ bundle_id: number; included: boolean; role?: string }[]>([])
  const [signIns, setSignIns] = useState<SignInChoice[]>([])
  const [signInErrors, setSignInErrors] = useState<Record<number, string>>({})
  const [people, setPeople] = useState<ExistingPerson[]>([])
  const [meds, setMeds] = useState<ExistingMedication[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [result, setResult] = useState<RestorePlan | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [passphrase, setPassphrase] = useState("")
  const [passphraseError, setPassphraseError] = useState<string | null>(null)

  useEffect(() => {
    if (!fileError || !formRef.current) return
    focusFirstInvalid(formRef.current)
  }, [fileError])

  useEffect(() => {
    if (!passphraseError || !formRef.current) return
    focusFirstInvalid(formRef.current)
  }, [passphraseError])

  useEffect(() => {
    if (!formRef.current || Object.keys(signInErrors).length === 0) return
    focusFirstInvalid(formRef.current)
  }, [signInErrors])

  useEffect(() => {
    if (!result) return
    const created = joinList(linesFor(result.created))
    const summary = [
      "Restore complete.",
      created ? `Created ${created}.` : "Nothing new was created.",
      ...resultNotes(result),
    ].join(" ")
    announce(summary)
    resultRef.current?.focus()
  }, [result])

  if (narrow) {
    return (
      <EmptyState icon={EMPTY_STATE_ICONS.desktopRequired} heading="Desktop Required">
        Restore requires a desktop browser. Open FamilyChart on a computer to upload an export, review it and apply it.
      </EmptyState>
    )
  }

  async function loadPreview(id: string) {
    const [previewRes, peopleRes, medsRes] = await Promise.all([
      fetch(`/api/restore/${id}`),
      fetch("/api/people?include_inactive=1"),
      fetch("/api/medications?include_inactive=1"),
    ])
    const preview = await previewRes.json() as RestorePlan & { error?: string }
    if (!previewRes.ok) {
      setFileError(preview.error ?? "Could not read that export.")
      return
    }
    const peopleBody = await peopleRes.json() as ExistingPerson[]
    const medsBody = await medsRes.json() as ExistingMedication[]
    setPeople(Array.isArray(peopleBody) ? peopleBody : [])
    setMeds(Array.isArray(medsBody) ? medsBody : [])
    setStagedId(id)
    setPendingId(null)
    setStepIndex(0)
    setPlan(preview)
    setPersons(preview.persons.map(person => ({
      bundle_id: person.bundle_id,
      action: person.suggested_action,
      target_id: person.suggested_action === "map" ? person.target_id : null,
    })))
    setMedications(preview.medications.map(medication => ({
      bundle_id: medication.bundle_id,
      action: medication.suggested_action,
      target_id: medication.suggested_action === "map" ? medication.target_id : null,
    })))
    if (preview.accounts !== "not restored") {
      setAccounts(preview.accounts.items.map(item => ({
        bundle_id: item.bundle_id,
        included: item.included,
        ...(item.role_needs_choice ? { role: item.role } : {}),
      })))
    } else {
      setAccounts([])
    }
    setSignInErrors({})
    setSignIns(wantsPersonSignIn(preview)
      ? preview.persons.map(person => ({ bundle_id: person.bundle_id, email: "", role: "none" }))
      : [])
  }

  async function onFile(file: File | null) {
    setFileError(null)
    setPassphraseError(null)
    setApplyError(null)
    setResult(null)
    setPlan(null)
    setStagedId(null)
    setPendingId(null)
    setPassphrase("")
    setConfirmed(false)
    if (!file) return
    setBusy("upload")
    try {
      const uploaded = await fetch("/api/restore/upload", {
        method: "POST",
        headers: { "content-type": "application/zip" },
        body: file,
      })
      const uploadBody = await uploaded.json() as { id?: string; error?: string; protected?: boolean }
      if (!uploaded.ok || !uploadBody.id) {
        setFileError(uploadBody.error ?? "Could not read that export.")
        return
      }
      if (uploadBody.protected) {
        setPendingId(uploadBody.id)
        return
      }
      await loadPreview(uploadBody.id)
    } catch {
      setFileError("Could not read that export.")
    } finally {
      setBusy(null)
    }
  }

  async function openProtected() {
    if (!pendingId) return
    setPassphraseError(null)
    setBusy("upload")
    try {
      const res = await fetch(`/api/restore/${pendingId}/passphrase`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase }),
      })
      const body = await res.json() as { error?: string }
      if (!res.ok) {
        const message = body.error ?? "That passphrase doesn't open this file"
        setPassphraseError(message)
        announce(message, "assertive")
        return
      }
      await loadPreview(pendingId)
    } catch {
      const message = "That passphrase doesn't open this file"
      setPassphraseError(message)
      announce(message, "assertive")
    } finally {
      setBusy(null)
    }
  }

  function setPerson(bundleId: number, next: Partial<Choice>) {
    setConfirmed(false)
    setPersons(current => current.map(row => row.bundle_id === bundleId ? { ...row, ...next } : row))
  }

  function setMedication(bundleId: number, next: Partial<Choice>) {
    setConfirmed(false)
    setMedications(current => current.map(row => row.bundle_id === bundleId ? { ...row, ...next } : row))
  }

  function setAccountIncluded(bundleId: number, included: boolean) {
    setConfirmed(false)
    setAccounts(current => current.map(row => row.bundle_id === bundleId ? { ...row, included } : row))
  }

  function setAccountRole(bundleId: number, role: string) {
    setConfirmed(false)
    setAccounts(current => current.map(row => row.bundle_id === bundleId ? { ...row, role } : row))
  }

  function setSignIn(bundleId: number, next: Partial<SignInChoice>) {
    setConfirmed(false)
    setSignInErrors(current => {
      if (!(bundleId in current)) return current
      const { [bundleId]: _removed, ...rest } = current
      return rest
    })
    setSignIns(current => current.map(row => row.bundle_id === bundleId ? { ...row, ...next } : row))
  }

  const mappingGap = persons.some(row => row.action === "map" && typeof row.target_id !== "number")
    || medications.some(row => row.action === "map" && typeof row.target_id !== "number")
  const applyReason = mappingGap
    ? "Choose an existing Person or medication for each one you are mapping."
    : !confirmed
      ? "Confirm you have reviewed this preview."
      : null

  const steps: RestoreStep[] = plan ? stepsFor(plan) : []
  const current: RestoreStep = steps[Math.min(stepIndex, steps.length - 1)] ?? "people"
  const unknownCatalogue = (plan?.warnings ?? []).filter(warning => warning.kind === "unknown_catalogue")

  function stepGap(step: RestoreStep): boolean {
    if (step === "people") return persons.some(row => row.action === "map" && typeof row.target_id !== "number")
    if (step === "medications") return medications.some(row => row.action === "map" && typeof row.target_id !== "number")
    return false
  }

  function goToStep(index: number) {
    setStepIndex(Math.max(0, Math.min(index, steps.length - 1)))
    requestAnimationFrame(() => stepRef.current?.focus())
  }

  async function apply() {
    if (!stagedId || !plan || applyReason) return
    const invalidEmail = signIns.find(row => {
      const email = row.email.trim()
      const action = persons.find(person => person.bundle_id === row.bundle_id)?.action
      return action !== "skip" && email !== "" && !isSignInEmail(email)
    })
    if (invalidEmail) {
      setStepIndex(0)
      setSignInErrors({ [invalidEmail.bundle_id]: "Enter a valid email address." })
      return
    }
    setApplyError(null)
    setSignInErrors({})
    setBusy("apply")
    try {
      const res = await fetch(`/api/restore/${stagedId}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          persons: persons.map(row => ({
            bundle_id: row.bundle_id,
            action: row.action,
            target_id: row.action === "map" ? row.target_id : null,
          })),
          medications: medications.map(row => ({
            bundle_id: row.bundle_id,
            action: row.action,
            target_id: row.action === "map" ? row.target_id : null,
          })),
          accounts: accounts.length > 0 ? accounts : undefined,
          person_sign_ins: signIns.length > 0 ? signIns.map(row => ({
            bundle_id: row.bundle_id,
            email: row.email.trim(),
            role: row.role,
          })) : undefined,
        }),
      })
      const body = await res.json() as RestorePlan & { error?: string; sign_in_bundle_id?: number }
      if (!res.ok) {
        if (typeof body.sign_in_bundle_id === "number" && body.error) {
          setStepIndex(0)
          setSignInErrors({ [body.sign_in_bundle_id]: body.error })
          return
        }
        setApplyError(body.error ?? "Restore failed.")
        announce(body.error ?? "Restore failed.", "assertive")
        return
      }
      setResult(body)
      setPlan(null)
    } catch {
      setApplyError("Restore failed.")
      announce("Restore failed.", "assertive")
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-label="Restore">
      <h2 className="fc-section-title fc-surface-title">Restore an export</h2>
      {result ? (
        <Panel>
          <ResultView plan={result} headingRef={resultRef} />
        </Panel>
      ) : (
        <Panel as="form" noValidate ref={formRef} onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          if (pendingId && !plan) void openProtected()
          else if (current === "review") void apply()
        }}>
          <FormField
            id="restore-file"
            label="Export file"
            hint={`A FamilyChart export (.zip), up to ${maxUploadMb} MB.`}
            error={fileError ?? undefined}
          >
            <FileInput accept=".zip,application/zip" onFileChange={file => { void onFile(file) }} />
          </FormField>
          {busy === "upload" && <p className="fc-section-copy">Reading the export…</p>}
          {pendingId && !plan && (
            <>
              <FormField label="Passphrase" error={passphraseError ?? undefined}>
                <Input
                  value={passphrase}
                  autoComplete="off"
                  onChange={event => {
                    setPassphrase(event.target.value)
                    setPassphraseError(null)
                  }}
                />
              </FormField>
              <Button type="submit" pending={busy === "upload"} pendingLabel="Checking…">Open export</Button>
            </>
          )}
          {plan && (
            <>
              <StepHeader headingRef={stepRef} index={stepIndex + 1} total={steps.length + 1} title={STEP_TITLES[current]} />
              {current === "people" && (
                <>
              <CardList>
                {plan.persons.map(person => {
                  const choice = persons.find(row => row.bundle_id === person.bundle_id)
                  const action = (choice?.action ?? person.suggested_action) as PersonAction
                  const targetId = choice?.target_id ?? null
                  const existing = people.find(row => row.id === targetId)
                  const datesDiffer = action === "map" && existing != null
                    && (existing.date_of_birth ?? null) !== (person.date_of_birth ?? null)
                  return (
                    <ListCard
                      key={person.bundle_id}
                      title={person.name}
                      extras={
                        <>
                          <div role="group" aria-label={`${person.name}, name and date of birth`}>
                            <FieldRow>
                              <p>In the export: {person.name}, <span>{dobText(person.date_of_birth)}</span></p>
                              {action === "map" && (
                                <p>On this instance: {existing ? <>{existing.name}, <span>{dobText(existing.date_of_birth)}</span></> : "Not chosen"}</p>
                              )}
                            </FieldRow>
                          </div>
                          {datesDiffer && <Banner kind="warning">The dates of birth differ.</Banner>}
                          <ChipGroup
                            legend={`What to do with ${person.name}`}
                            options={PERSON_OPTIONS}
                            value={action}
                        onChange={value => setPerson(person.bundle_id, {
                          action: value,
                          target_id: value === "map" ? (targetId ?? person.target_id) : targetId,
                        })}
                          />
                          {action === "map" && (
                            <FormField label={`Existing person for ${person.name}`}>
                              <Select
                                value={targetId ?? ""}
                                onChange={event => setPerson(person.bundle_id, {
                                  action: "map",
                                  target_id: event.target.value === "" ? null : Number(event.target.value),
                                })}
                              >
                                <option value="">Choose a person</option>
                                {people.map(row => (
                                  <option key={row.id} value={row.id}>
                                    {row.name}{row.is_active === 0 ? " (inactive)" : ""}
                                  </option>
                                ))}
                              </Select>
                            </FormField>
                          )}
                          {wantsPersonSignIn(plan) && action !== "skip" && (
                            <>
                              <FormField
                                label="Sign-in for this Person"
                                optional
                                hint="Leave blank to restore this Person without their personal settings."
                                error={signInErrors[person.bundle_id]}
                              >
                                <Input
                                  type="email"
                                  autoComplete="off"
                                  value={signIns.find(row => row.bundle_id === person.bundle_id)?.email ?? ""}
                                  onChange={event => setSignIn(person.bundle_id, { email: event.target.value })}
                                />
                              </FormField>
                              <FormField label="Household Role">
                                <Select
                                  value={signIns.find(row => row.bundle_id === person.bundle_id)?.role ?? "none"}
                                  onChange={event => setSignIn(person.bundle_id, { role: event.target.value })}
                                >
                                  {SIGN_IN_ROLES.map(role => (
                                    <option key={role.value} value={role.value}>{role.label}</option>
                                  ))}
                                </Select>
                              </FormField>
                            </>
                          )}
                        </>
                      }
                    />
                  )
                })}
              </CardList>
                </>
              )}
              {current === "medications" && (
                <>
              <CardList>
                {plan.medications.map(medication => {
                  const choice = medications.find(row => row.bundle_id === medication.bundle_id)
                  const action = (choice?.action ?? medication.suggested_action) as MedicationAction
                  const targetId = choice?.target_id ?? null
                  return (
                    <ListCard
                      key={medication.bundle_id}
                      title={medication.name}
                      extras={
                        <>
                          <ChipGroup
                            legend={`What to do with ${medication.name}`}
                            options={MEDICATION_OPTIONS}
                            value={action}
                        onChange={value => setMedication(medication.bundle_id, {
                          action: value,
                          target_id: value === "map" ? (targetId ?? medication.target_id) : targetId,
                        })}
                          />
                          {action === "map" && (
                            <FormField label={`Existing medication for ${medication.name}`}>
                              <Select
                                value={targetId ?? ""}
                                onChange={event => setMedication(medication.bundle_id, {
                                  action: "map",
                                  target_id: event.target.value === "" ? null : Number(event.target.value),
                                })}
                              >
                                <option value="">Choose a medication</option>
                                {meds.map(row => (
                                  <option key={row.id} value={row.id}>
                                    {row.name}{row.is_active === 0 ? " (inactive)" : ""}
                                  </option>
                                ))}
                              </Select>
                            </FormField>
                          )}
                        </>
                      }
                    />
                  )
                })}
              </CardList>
                </>
              )}
              {current === "accounts" && (
                <>
              {plan.accounts !== "not restored" && (
                <>
                  <h3 className="fc-section-title">Accounts</h3>
                  {plan.accounts.status === "skipped_preflight" && (
                    <Banner kind="info">{plan.accounts.message}</Banner>
                  )}
                  <CardList>
                    {plan.accounts.items.map(item => {
                      const choice = accounts.find(row => row.bundle_id === item.bundle_id)
                      const included = choice?.included ?? item.included
                      const disabled = !accountSelectable(item)
                      return (
                        <ListCard
                          key={item.bundle_id}
                          title={item.email}
                          extras={
                            <>
                              <p>{item.role_needs_choice ? "Role not stored (assigned by Entra groups)" : item.role === "none" ? "Role None" : `Role ${item.role}`}{item.person_name ? ` · linked to ${item.person_name} in the export` : ""}</p>
                              {item.method_change_note && <Banner kind="info">{item.method_change_note}</Banner>}
                              {item.note && <p>{item.note}</p>}
                              {item.skip_reason === "email_exists" && (
                                <p>An Account with this email already exists on this instance — it will not be changed.</p>
                              )}
                              {item.skip_reason === "person_skipped" && <p>{item.note}</p>}
                              {item.role_needs_choice && (
                                <FormField
                                  label={`Household Role for ${item.email}`}
                                  hint="Their role came from Entra groups and was not stored in the export."
                                >
                                  <Select
                                    value={choice?.role ?? item.role}
                                    disabled={disabled}
                                    onChange={event => setAccountRole(item.bundle_id, event.target.value)}
                                  >
                                    {HOUSEHOLD_ROLE_OPTIONS.map(role => (
                                      <option key={role.value} value={role.value}>{role.label}</option>
                                    ))}
                                  </Select>
                                </FormField>
                              )}
                              <Checkbox
                                label={`Invite ${item.email}`}
                                checked={included}
                                disabled={disabled}
                                onChange={event => setAccountIncluded(item.bundle_id, event.target.checked)}
                              />
                            </>
                          }
                        />
                      )
                    })}
                  </CardList>
                </>
              )}
                </>
              )}
              {current === "review" && (
                <>
              {plan.warnings.filter(warning => warning.kind === "skipped_file").map(warning => (
                <Banner key={`${warning.path}-${warning.reason}`} kind="warning">
                  {`A file was left out of the export: ${warning.path}. ${warning.reason ?? ""}`.trim()}
                </Banner>
              ))}
              {unknownCatalogue.length > 0 && (
                <Banner kind="warning">
                  {`This instance does not have ${unknownCatalogue.length} ${unknownCatalogue.length === 1 ? "entry" : "entries"} the export uses. Records for ${unknownCatalogue.length === 1 ? "it" : "them"} will be skipped: ${joinList(unknownCatalogue.map(warning => warning.name ?? ""))}.`}
                </Banner>
              )}
              {plan.differences.length > 0 && (
                <>
                  <h3 className="fc-section-title">Differences</h3>
                  <ul className="fc-restore-lines">
                    {plan.differences.map(row => (
                      <li key={differenceText(row)}>{differenceText(row)}</li>
                    ))}
                  </ul>
                </>
              )}
              {plan.settings !== "not restored" && plan.settings.differences.length > 0 && (
                <>
                  <h3 className="fc-section-title">Settings differences</h3>
                  <ul className="fc-restore-lines">
                    {plan.settings.differences.map(row => (
                      <li key={row.key}>{settingDifferenceText(row)}</li>
                    ))}
                  </ul>
                </>
              )}
              <dl className="fc-dl" aria-label="Counts">
                <dt>New</dt><dd>{plan.counts.new}</dd>
                <dt>Duplicates</dt><dd>{plan.counts.duplicate}</dd>
                <dt>Differences</dt><dd>{plan.counts.differing}</dd>
                <dt>Skipped</dt><dd>{plan.counts.skipped}</dd>
              </dl>
              {previewNotes(plan).length > 0 && (
                <Banner kind="info">{previewNotes(plan).join(" ")}</Banner>
              )}
              <Checkbox
                label="I have reviewed this preview"
                checked={confirmed}
                onChange={event => setConfirmed(event.target.checked)}
              />
              {applyError && <Banner kind="error">{applyError}</Banner>}
              <div className="fc-restore-nav">
                <Button variant="secondary" onClick={() => goToStep(stepIndex - 1)}>Back</Button>
                <Button type="submit" pending={busy === "apply"} pendingLabel="Applying…" {...disabledWhen(busy === "apply" ? "Applying…" : applyReason)}>
                  Apply restore
                </Button>
              </div>
                </>
              )}
              {applyError && current !== "review" && <Banner kind="error">{applyError}</Banner>}
              {current !== "review" && (
                <div className="fc-restore-nav">
                  {stepIndex > 0 && <Button variant="secondary" onClick={() => goToStep(stepIndex - 1)}>Back</Button>}
                  <Button onClick={() => goToStep(stepIndex + 1)} {...disabledWhen(stepGap(current) ? "Choose an existing item for each one you are mapping." : null)}>Next</Button>
                </div>
              )}
            </>
          )}
        </Panel>
      )}
    </section>
  )
}

function ResultView({ plan, headingRef }: { plan: RestorePlan; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const createdPeople = plan.persons.filter(person => person.suggested_action === "new").map(person => person.name)
  const skippedPeople = plan.persons.filter(person => person.suggested_action === "skip").map(person => person.name)
  const createdMeds = plan.medications.filter(medication => medication.suggested_action === "new").map(medication => medication.name)
  const mappedPeople = plan.persons.filter(person => person.suggested_action === "map").map(person => person.name)
  const otherCreated = linesFor(plan.created).filter(line => !line.endsWith("person") && !line.endsWith("people") && !line.endsWith("medication") && !line.endsWith("medications"))
  const createdNames = [...createdPeople, ...createdMeds]
  const skippedDuplicates = linesFor(plan.duplicates)
  const unknown = plan.skipped_unknown.map(row => `${row.count} ${row.name} (${row.catalogue === "test_metric" ? "test metric" : "observation type"})`)

  return (
    <div>
      <h3 ref={headingRef} tabIndex={-1} className="fc-section-title">Restore complete</h3>
      <ul className="fc-restore-lines">
        <li>
          {createdNames.length || otherCreated.length
            ? `Created ${joinList([...createdNames, ...otherCreated])}.`
            : "Nothing new was created."}
        </li>
        {mappedPeople.length > 0 && <li>{`Mapped ${joinList(mappedPeople)} onto an existing person.`}</li>}
        {skippedPeople.map(name => <li key={name}>{`Skipped ${name}.`}</li>)}
        {skippedDuplicates.length > 0 && <li>{`Skipped ${joinList(skippedDuplicates.map(line => `${line} already on this instance`))}.`}</li>}
        {unknown.map(line => <li key={line}>{`Skipped ${line}. This instance does not have it.`}</li>)}
        {resultNotes(plan).map(line => <li key={line}>{line}</li>)}
      </ul>
    </div>
  )
}
