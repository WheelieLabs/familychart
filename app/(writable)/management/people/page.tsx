// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useState, useEffect } from "react"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import FormField from "@/components/FormField"
import Modal from "@/components/Modal"
import PersonPhotoCapture from "@/components/PersonPhotoCapture"
import type { Person } from "@/lib/domain-types"
import ConfirmModal, { confirmCopy, type ConfirmVariant } from "@/components/ConfirmModal"
import { EntityRowDeleteButton, EntityRowEditButton } from "@/components/EntityRowActions"
import ManagementStickyAdd from "@/components/ManagementStickyAdd"
import { mainContentTargetProps } from "@/lib/a11y"
import { formatCount } from "@/lib/format-count"
import { completedCalendarYears } from "@/lib/person/person-age"
import { accountUidFromRow } from "@/lib/account/account-uid"

const PERSON_PHOTO_ASPECT = 1
const PERSON_PHOTO_MAX_EDGE = 1024
const PERSON_PHOTO_QUALITY = 0.8

interface CurrentUser { id: string; name: string | null; email: string | null }
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

const AVATAR_COLOURS = ["#256AA5","#E05C2A","#2EA86A","#8B3FC2","#C22B6E","#2BA8C2","#C2A32B","#606060"]

function formatDob(dob: string | null): string {
  if (!dob) return ""
  return new Date(dob + "T00:00:00").toLocaleDateString("en-AU", {
    day: "2-digit", month: "short", year: "numeric"
  })
}

function ageFromDob(dob: string | null, timeZone: string | null): string {
  if (!dob || !timeZone) return ""
  const age = completedCalendarYears(dob, timeZone)
  if (!Number.isFinite(age)) return ""
  return formatCount(age, "yr")
}

export default function ManagePeoplePage() {
  const [people, setPeople]         = useState<Person[]>([])
  const [editing, setEditing]       = useState<Partial<Person> | null>(null)
  const [saving, setSaving]         = useState(false)
  const [uploading, setUploading]   = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [currentUser, setCurrentUser]   = useState<CurrentUser | null>(null)
  const [instanceTimezone, setInstanceTimezone] = useState<string | null>(null)
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

  async function load() {
    const [peopleRes, meRes, accountsRes] = await Promise.all([
      fetch("/api/people"),
      fetch("/api/me"),
      fetch("/api/accounts/invites"),
    ])
    setPeople(await peopleRes.json())
    const me = await meRes.json() as CurrentUser & { instanceTimezone?: string }
    setCurrentUser(me)
    setInstanceTimezone(
      typeof me.instanceTimezone === "string" && me.instanceTimezone.trim() !== ""
        ? me.instanceTimezone
        : null,
    )
    if (accountsRes.ok) setAccounts(await accountsRes.json())
  }
  useEffect(() => { load() }, [])

  function openEdit(person?: Person) {
    setSaveErr("")
    setEditing(person ?? {
      name: "",
      full_name: null,
      color: AVATAR_COLOURS[0],
      sort_order: people.length,
      account_uid: null,
      date_of_birth: null,
    })
    setPreviewUrl(person?.photo_url ?? null)
  }
  function closeEdit() {
    setEditing(null); setPreviewUrl(null); setSaveErr("")
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
    if (!editing?.name?.trim()) return
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
      <AppHeader title="Manage People" />
      <main {...mainContentTargetProps} className="fc-surface-app fc-scroll flex flex-col min-h-0">
        <div className="flex flex-col gap-3 p-3 flex-1">
        {people.map(p => (
          <div key={p.id} className="bg-white/10 rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="w-12 h-12 rounded-full border-2 border-fc-ring overflow-hidden shrink-0
                            flex items-center justify-center" style={{ backgroundColor: p.color }}>
              {p.photo_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={p.photo_url} alt={p.name} className="w-full h-full object-cover" />
                : <span className="text-white font-bold">{initials(p.name)}</span>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white font-bold">{p.name}</div>
              <div className="text-white/50 text-xs flex gap-2">
                {p.date_of_birth && (
                  <span>
                    {formatDob(p.date_of_birth)}
                    {instanceTimezone ? ` · ${ageFromDob(p.date_of_birth, instanceTimezone)}` : ""}
                  </span>
                )}
                {p.account_uid && <span>🔗 Linked</span>}
              </div>
            </div>
            <EntityRowEditButton onClick={() => openEdit(p)} />
            <EntityRowDeleteButton
              aria-label={`Remove ${p.name}`}
              onClick={() => promptRemovePerson(p.id)}
            />
          </div>
        ))}
        </div>
        <ManagementStickyAdd onClick={() => openEdit()}>
          + Add Family Member
        </ManagementStickyAdd>
      </main>

      {editing && (
        <Modal open onClose={closeEdit} title={`${editing.id ? "Edit" : "Add"} Family Member`}>
            {/* Photo */}
            <div>
              <label className="text-sm font-bold text-gray-700 block mb-2">Photo</label>
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-full border-2 border-fc-ring overflow-hidden shrink-0
                                flex items-center justify-center"
                     style={{ backgroundColor: editing.color ?? AVATAR_COLOURS[0] }}>
                  {previewUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                    : <span className="text-white font-bold text-2xl">{initials(editing.name ?? "?")}</span>}
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
                    <button onClick={() => { setPreviewUrl(null); setEditing(v => ({ ...v!, photo_url: null })) }}
                      className="text-red-500 text-xs underline">Remove photo</button>
                  )}
                </div>
              </div>
            </div>

            {/* Display name */}
            <FormField label="Display name" hint="Home screen and person header">
              <input type="text" value={editing.name ?? ""} autoFocus
                onChange={e => setEditing(v => ({ ...v!, name: e.target.value }))}
                className="w-full border border-gray-300 rounded px-3 py-2 text-gray-800" />
            </FormField>

            <FormField label="Full name" hint="Reports and formal use (optional)">
              <input type="text" value={editing.full_name ?? ""}
                onChange={e => setEditing(v => ({
                  ...v!,
                  full_name: e.target.value.trim() === "" ? null : e.target.value,
                }))}
                className="w-full border border-gray-300 rounded px-3 py-2 text-gray-800" />
            </FormField>

            {/* DOB */}
            <FormField label="Date of Birth">
              <input type="date" value={editing.date_of_birth ?? ""}
                onChange={e => setEditing(v => ({ ...v!, date_of_birth: e.target.value || null }))}
                className="w-full border border-gray-300 rounded px-3 py-2 text-gray-800" />
            </FormField>
            {editing.date_of_birth && instanceTimezone && (
              <p className="text-xs text-gray-500 -mt-2">
                Age: {ageFromDob(editing.date_of_birth, instanceTimezone)} — used to filter age-appropriate medications
              </p>
            )}

            {/* Colour */}
            <div>
              <label className="text-sm font-bold text-gray-700 block mb-2">Avatar Colour</label>
              <div className="flex gap-2 flex-wrap">
                {AVATAR_COLOURS.map(c => (
                  <button key={c} onClick={() => setEditing(v => ({ ...v!, color: c }))}
                    className={`w-9 h-9 rounded-full border-2 transition-transform
                      ${editing.color === c ? "border-gray-800 scale-110" : "border-transparent"}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>

            {/* Sort order */}
            <FormField label="Sort Order">
              <input type="number" value={editing.sort_order ?? 0} min="0"
                onChange={e => setEditing(v => ({ ...v!, sort_order: parseInt(e.target.value) }))}
                className="w-24 border border-gray-300 rounded px-3 py-2 text-gray-800" />
            </FormField>

            {/* Linked Account */}
            {accounts.length > 0 && (
              <FormField
                label="Linked Account"
                hint="Gives this person read/write access to their own record."
              >
                <select
                  value={editing.account_uid ?? ""}
                  onChange={e => setEditing(v => ({ ...v!, account_uid: e.target.value || null }))}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-gray-800 bg-white"
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
                </select>
              </FormField>
            )}
            {currentUser?.id && (
              <button type="button" onClick={() => setEditing(v => ({ ...v!, account_uid: currentUser.id }))}
                className="-mt-2 text-xs bg-fc-blue text-white px-3 py-1.5 rounded-lg
                           hover:bg-fc-blue-mid transition-colors">
                Use my account ({currentUser.email})
              </button>
            )}

            {saveErr && <p className="text-red-600 text-sm">{saveErr}</p>}

            <div className="flex gap-3">
              <button onClick={closeEdit} className="flex-1 border border-gray-400 rounded-xl py-3 text-gray-700 font-bold">Cancel</button>
              <button onClick={handleSave} disabled={saving || uploading}
                className="flex-1 bg-fc-blue text-white font-bold rounded-xl py-3 disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
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
