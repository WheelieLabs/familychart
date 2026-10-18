// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useState, useEffect, useRef } from "react"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import Modal from "@/components/Modal"
import PersonPhotoCapture from "@/components/PersonPhotoCapture"
import type { Person } from "@/lib/domain-types"
import ConfirmModal, { confirmCopy, type ConfirmVariant } from "@/components/ConfirmModal"
import ManagementStickyAdd from "@/components/ManagementStickyAdd"
import Badge from "@/components/ui/Badge"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import { ChipGroup } from "@/components/ui/Chip"
import { Input, Select } from "@/components/ui/controls"
import DateEcho from "@/components/ui/DateEcho"
import EmptyState, { EMPTY_STATE_ICONS } from "@/components/ui/EmptyState"
import EntityRowActions from "@/components/ui/EntityRowActions"
import FormField, { FieldGroup } from "@/components/ui/FormField"
import ListCard, { CardList } from "@/components/ui/ListCard"
import PageContainer from "@/components/ui/PageContainer"
import { formatDobWithAge, getDisplayTimeZone } from "@/lib/date-format"
import { formatCount } from "@/lib/format-count"
import { completedCalendarYears } from "@/lib/person/person-age"
import { accountUidFromRow } from "@/lib/account/account-uid"
import { focusFirstInvalid } from "@/lib/ui/form-errors"
import { managementTrail } from "@/lib/ui/breadcrumbs"

const PERSON_PHOTO_ASPECT = 1
const PERSON_PHOTO_MAX_EDGE = 1024
const PERSON_PHOTO_QUALITY = 0.8

interface CurrentUser { id: string; name: string | null; email: string | null; role?: string | null }
interface AccountOption {
  id: number
  email: string
  auth_method: "local" | "entra"
  external_id: string | null
  status: "invited" | "active"
  linkable: number
}

/** `local:<id>` for a local account, the raw Entra oid otherwise — the unchanged
 * `people.account_uid` value convention (see lib/people-user-uid.ts). */
function accountUidFor(a: AccountOption): string | null {
  return accountUidFromRow(a)
}

function accountLabel(a: AccountOption): string {
  if (a.status !== "invited") return a.email
  return a.linkable ? `${a.email} (invite pending)` : `${a.email} (invite expired/revoked)`
}

const AVATAR_COLOURS = [
  { value: "#256AA5", name: "Blue" },
  { value: "#E05C2A", name: "Orange" },
  { value: "#2EA86A", name: "Green" },
  { value: "#8B3FC2", name: "Purple" },
  { value: "#C22B6E", name: "Pink" },
  { value: "#2BA8C2", name: "Teal" },
  { value: "#C2A32B", name: "Gold" },
  { value: "#606060", name: "Grey" },
]

function ageFromDob(dob: string | null): string {
  if (!dob) return ""
  const age = completedCalendarYears(dob, getDisplayTimeZone())
  if (!Number.isFinite(age)) return ""
  return formatCount(age, "yr")
}

export default function ManagePeoplePage() {
  const [people, setPeople]         = useState<Person[]>([])
  const [loaded, setLoaded]         = useState(false)
  const [editing, setEditing]       = useState<Partial<Person> | null>(null)
  const [saving, setSaving]         = useState(false)
  const [uploading, setUploading]   = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [currentUser, setCurrentUser]   = useState<CurrentUser | null>(null)
  const [accounts, setAccounts] = useState<AccountOption[]>([])
  const [confirmDlg, setConfirmDlg] = useState<null | {
    title: string
    message: string
    detail?: string
    variant: ConfirmVariant
    confirmLabel?: string
    cancelLabel?: string
    showCancel?: boolean
    onConfirm: () => void | Promise<void>
  }>(null)

  const [noticeDlg, setNoticeDlg] = useState<{ title: string; message: string } | null>(null)
  const [saveErr, setSaveErr] = useState("")
  const [nameErr, setNameErr] = useState("")
  const formRef = useRef<HTMLDivElement>(null)

  async function load() {
    const [peopleRes, meRes, accountsRes] = await Promise.all([
      fetch("/api/people"),
      fetch("/api/me"),
      fetch("/api/accounts/invites"),
    ])
    setPeople(await peopleRes.json())
    setCurrentUser(await meRes.json() as CurrentUser)
    if (accountsRes.ok) setAccounts(await accountsRes.json())
    setLoaded(true)
  }
  useEffect(() => { load() }, [])

  function openEdit(person?: Person) {
    setSaveErr("")
    setNameErr("")
    setEditing(person ?? {
      name: "",
      full_name: null,
      color: AVATAR_COLOURS[0].value,
      sort_order: people.length,
      account_uid: null,
      date_of_birth: null,
    })
    setPreviewUrl(person?.photo_url ?? null)
  }
  function closeEdit() {
    setEditing(null); setPreviewUrl(null); setSaveErr(""); setNameErr("")
  }

  async function handleCroppedPhoto(blob: Blob) {
    if (!editing) return
    setPreviewUrl(URL.createObjectURL(blob))
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", blob, "photo.jpg")
      if (editing.id) fd.append("person_id", String(editing.id))
      const res = await fetch("/api/upload", { method: "POST", body: fd })
      if (!res.ok) throw new Error()
      const { url } = await res.json()
      setEditing(v => ({ ...v!, photo_url: url }))
    } catch {
      setNoticeDlg({
        title: "Photo upload failed",
        message: "Please try again.",
      })
      setPreviewUrl(editing?.photo_url ?? null)
    } finally { setUploading(false) }
  }

  async function handleSave() {
    if (!editing?.name?.trim()) {
      setNameErr("Enter a display name.")
      // Focus once the error has rendered.
      setTimeout(() => { if (formRef.current) focusFirstInvalid(formRef.current) }, 0)
      return
    }
    setNameErr("")
    setSaving(true)
    setSaveErr("")
    const isNew = !editing.id
    try {
      const res = await fetch(isNew ? "/api/people" : `/api/people/${editing.id}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setSaveErr(typeof j.error === "string" ? j.error : "Save failed.")
        setSaving(false)
        return
      }
      await load()
      closeEdit()
    } catch {
      setSaveErr("Save failed.")
    }
    setSaving(false)
  }

  function promptRemovePerson(id: number) {
    setConfirmDlg({
      ...confirmCopy.removePersonFromList,
      onConfirm: async () => {
        await fetch(`/api/people/${id}`, { method: "DELETE" })
        await load()
        setConfirmDlg(null)
      },
    })
  }

  const initials = (name: string) => name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="People" />
      <PageContainer trail={managementTrail({ label: "People" })}>
        {loaded && people.length === 0 && (
          <EmptyState icon={EMPTY_STATE_ICONS.noPeople} heading="No people yet">
            Add the first family member to start recording.
          </EmptyState>
        )}
        <CardList>
          {people.map(p => (
            <ListCard
              key={p.id}
              title={p.name}
              avatar={{ src: p.photo_url, name: p.name }}
              meta={[p.date_of_birth ? formatDobWithAge(p.date_of_birth) : null]}
              extras={p.account_uid ? <Badge tone="info">🔗 Linked</Badge> : undefined}
              trailing={
                <EntityRowActions
                  name={p.name}
                  onEdit={() => openEdit(p)}
                  onDelete={() => promptRemovePerson(p.id)}
                  deleteLabel="Remove"
                />
              }
            />
          ))}
        </CardList>
        <ManagementStickyAdd onClick={() => openEdit()}>
          + Add Family Member
        </ManagementStickyAdd>
      </PageContainer>

      {editing && (
        <Modal open onClose={closeEdit} title={`${editing.id ? "Edit" : "Add"} family member`}>
          <div ref={formRef} className="fc-form">
            <FieldGroup label="Photo" optional>
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-full overflow-hidden shrink-0 flex items-center justify-center"
                     style={{ backgroundColor: editing.color ?? AVATAR_COLOURS[0].value }}>
                  {previewUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={previewUrl} alt="" className="w-full h-full object-cover" />
                    : <span aria-hidden="true" className="text-white font-bold text-2xl">{initials(editing.name || "?")}</span>}
                </div>
                <div className="flex flex-col gap-2">
                  <PersonPhotoCapture
                    aspect={PERSON_PHOTO_ASPECT}
                    maxEdge={PERSON_PHOTO_MAX_EDGE}
                    quality={PERSON_PHOTO_QUALITY}
                    uploading={uploading}
                    hasPhoto={!!previewUrl}
                    onPhoto={handleCroppedPhoto}
                  />
                  {previewUrl && (
                    <Button variant="quiet" onClick={() => { setPreviewUrl(null); setEditing(v => ({ ...v!, photo_url: null })) }}>
                      Remove photo
                    </Button>
                  )}
                </div>
              </div>
            </FieldGroup>

            <FormField label="Display name" hint="Shown on the home screen and the person header" error={nameErr || undefined}>
              <Input type="text" value={editing.name ?? ""} autoFocus
                onChange={e => { setEditing(v => ({ ...v!, name: e.target.value })); setNameErr("") }} />
            </FormField>

            <FormField label="Full name" optional hint="Used in reports and formal documents">
              <Input type="text" value={editing.full_name ?? ""}
                onChange={e => setEditing(v => ({
                  ...v!,
                  full_name: e.target.value.trim() === "" ? null : e.target.value,
                }))} />
            </FormField>

            <FormField
              label="Date of birth"
              optional
              hint={editing.date_of_birth ? `Age ${ageFromDob(editing.date_of_birth)}. Used to filter age-appropriate medications.` : "Used to filter age-appropriate medications"}
            >
              <Input type="date" value={editing.date_of_birth ?? ""}
                onChange={e => setEditing(v => ({ ...v!, date_of_birth: e.target.value || null }))} />
              <DateEcho date={editing.date_of_birth ?? ""} />
            </FormField>

            <ChipGroup
              legend="Avatar colour"
              options={AVATAR_COLOURS.map(c => ({
                value: c.value,
                label: (
                  <>
                    <span
                      aria-hidden="true"
                      style={{ display: "inline-block", width: 12, height: 12, borderRadius: 9999, backgroundColor: c.value }}
                    />
                    {c.name}
                  </>
                ),
              }))}
              value={editing.color ?? AVATAR_COLOURS[0].value}
              onChange={color => setEditing(v => ({ ...v!, color }))}
            />

            <FormField label="Sort order" hint="Lower numbers come first">
              <Input type="number" value={editing.sort_order ?? 0} min="0"
                onChange={e => setEditing(v => ({ ...v!, sort_order: parseInt(e.target.value) }))} />
            </FormField>

            {accounts.length > 0 && (
              <FormField
                label="Linked account"
                hint="Gives this person read/write access to their own record."
              >
                <Select
                  value={editing.account_uid ?? ""}
                  onChange={e => setEditing(v => ({ ...v!, account_uid: e.target.value || null }))}
                >
                  <option value="">None</option>
                  {editing.account_uid && !accounts.some(a => accountUidFor(a) === editing.account_uid) && (
                    // The current link has no matching accounts row yet — e.g. a pre-existing
                    // Entra-oid link from before this instance's accounts unification, which
                    // only gets a row on that identity's next sign-in. Without this, a plain
                    // <select> would silently drop it and appear to show "None" instead.
                    <option value={editing.account_uid} disabled>
                      Unrecognized link ({editing.account_uid})
                    </option>
                  )}
                  {accounts.map(a => {
                    const uid = accountUidFor(a)
                    if (!uid) return null
                    return (
                      <option key={uid} value={uid} disabled={!a.linkable && uid !== editing.account_uid}>
                        {accountLabel(a)}
                      </option>
                    )
                  })}
                </Select>
              </FormField>
            )}
            {currentUser?.id && currentUser.role === "admin" && (
              <div>
                <Button variant="secondary" onClick={() => setEditing(v => ({ ...v!, account_uid: currentUser.id }))}>
                  Use my account ({currentUser.email})
                </Button>
              </div>
            )}

            {saveErr && <Banner kind="error">{saveErr}</Banner>}

            <div className="fc-form-actions">
              <Button variant="secondary" onClick={closeEdit}>Cancel</Button>
              {uploading ? (
                <Button disabled disabledReason="Wait for the photo to finish uploading.">Save</Button>
              ) : (
                <Button onClick={handleSave} pending={saving}>Save</Button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {confirmDlg && (
        <ConfirmModal
          open
          title={confirmDlg.title}
          message={confirmDlg.message}
          detail={confirmDlg.detail}
          variant={confirmDlg.variant}
          confirmLabel={confirmDlg.confirmLabel}
          cancelLabel={confirmDlg.cancelLabel}
          showCancel={confirmDlg.showCancel ?? true}
          onCancel={() => setConfirmDlg(null)}
          onConfirm={confirmDlg.onConfirm}
        />
      )}

      {noticeDlg && (
        <ConfirmModal
          open
          title={noticeDlg.title}
          message={noticeDlg.message}
          variant="danger"
          confirmLabel="OK"
          showCancel={false}
          onCancel={() => setNoticeDlg(null)}
          onConfirm={() => setNoticeDlg(null)}
        />
      )}

      <AppFooter />
    </div>
  )
}
