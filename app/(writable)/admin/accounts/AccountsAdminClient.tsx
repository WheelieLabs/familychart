// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import Toggle from "@/components/Toggle"
import ConfirmModal from "@/components/ConfirmModal"
import Modal from "@/components/Modal"
import { EntityRowEditButton } from "@/components/EntityRowActions"
import { mainContentTargetProps } from "@/lib/a11y"
import { accountInviteDisplayStatus, type AccountInviteDisplayStatus } from "@/lib/invite"
import type { Person } from "@/lib/domain-types"

interface AccountRow {
  id: number
  email: string
  role: string
  can_report: number
  is_active: number
  auth_method: "local" | "entra"
  status: "invited" | "active"
  invite_expires_at: string | null
  invite_revoked_at: string | null
  mfa_enrolled: number
  created_at: string
}

interface EditForm {
  role: string
  can_report: number
  is_active: number
}

type InviteView = "fields" | "person" | "link" | "create" | "none"

const ROLES = [
  { value: "admin", label: "Admin" },
  { value: "manage", label: "Manager" },
  { value: "write", label: "Read/Write" },
  { value: "read",  label: "Read Only" },
]

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  manage: "Manager",
  write: "Read/Write",
  read:  "Read Only",
}

const STATUS_LABELS: Record<AccountInviteDisplayStatus, string> = {
  active: "Active",
  invited: "Invited",
  expired: "Expired",
  revoked: "Revoked",
}

const STATUS_BADGE_CLASS: Record<AccountInviteDisplayStatus, string> = {
  active: "bg-green-100 text-green-800",
  invited: "bg-amber-100 text-amber-800",
  expired: "bg-gray-200 text-gray-700",
  revoked: "bg-red-100 text-red-800",
}

function emptyInvite() {
  return { email: "", role: "read", personId: "", personName: "" }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "2-digit", month: "short", year: "numeric",
  })
}

export default function AccountsAdminClient({
  entraActive,
  emailConfigured,
}: {
  entraActive: boolean
  emailConfigured: boolean
}) {
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteView, setInviteView] = useState<InviteView>("fields")
  const [invite, setInvite] = useState(emptyInvite())
  const [editing, setEditing] = useState<AccountRow | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({ role: "read", can_report: 0, is_active: 1 })
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState("")
  const [notice, setNotice] = useState("")
  const [clearingMfa, setClearingMfa] = useState(false)
  const [mfaClearDlg, setMfaClearDlg] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<AccountRow | null>(null)
  const [rowBusyId, setRowBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [accountsRes, peopleRes] = await Promise.all([
        fetch("/api/accounts/invites"),
        fetch("/api/people"),
      ])
      if (accountsRes.ok) setAccounts(await accountsRes.json())
      if (peopleRes.ok) setPeople(await peopleRes.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const unlinkedPeople = people.filter(p => !p.account_uid)

  function openInvite() {
    setInvite(emptyInvite())
    setInviteView("fields")
    setSaveErr("")
    setInviteOpen(true)
  }

  function closeInvite() {
    setInviteOpen(false)
    setSaveErr("")
  }

  function openEdit(account: AccountRow) {
    setEditForm({ role: account.role, can_report: account.can_report, is_active: account.is_active })
    setSaveErr("")
    setEditing(account)
  }

  function closeEdit() {
    setEditing(null)
    setSaveErr("")
  }

  async function submitInvite(personAction: "link" | "create" | "none") {
    const email = invite.email.trim()
    if (!email) { setSaveErr("Email is required."); return }
    if (personAction === "link" && !invite.personId) {
      setSaveErr("Pick a Person to link."); return
    }
    if (personAction === "create" && !invite.personName.trim()) {
      setSaveErr("Person name is required."); return
    }
    setSaving(true)
    setSaveErr("")
    try {
      const res = await fetch("/api/accounts/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          role: invite.role,
          personAction,
          personId: personAction === "link" ? Number(invite.personId) : undefined,
          personName: personAction === "create" ? invite.personName.trim() : undefined,
        }),
      })
      const j = await res.json().catch(() => ({})) as { error?: string; emailError?: string }
      if (!res.ok) {
        setSaveErr(typeof j.error === "string" ? j.error : "Invite failed.")
        return
      }
      closeInvite()
      if (typeof j.emailError === "string" && j.emailError) {
        setNotice(`Invite created, but the email did not send: ${j.emailError} Use Resend to try again.`)
      } else {
        setNotice("")
      }
      await load()
    } catch {
      setSaveErr("Invite failed.")
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveEdit() {
    if (!editing) return
    setSaving(true)
    setSaveErr("")
    try {
      const body: Record<string, unknown> = {
        can_report: editForm.can_report,
        is_active: editForm.is_active,
      }
      if (editing.auth_method !== "entra") body.role = editForm.role
      const res = await fetch(`/api/accounts/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setSaveErr(typeof j.error === "string" ? j.error : "Save failed.")
        return
      }
      closeEdit()
      await load()
    } catch {
      setSaveErr("Save failed.")
    } finally {
      setSaving(false)
    }
  }

  async function handleClearMfa() {
    if (!editing) return
    setClearingMfa(true)
    setSaveErr("")
    setMfaClearDlg(false)
    try {
      const res = await fetch(`/api/accounts/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear_mfa: true }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setSaveErr(typeof j.error === "string" ? j.error : "Request failed.")
        return
      }
      closeEdit()
      await load()
    } catch {
      setSaveErr("Request failed.")
    } finally {
      setClearingMfa(false)
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return
    setRowBusyId(revokeTarget.id)
    setNotice("")
    try {
      const res = await fetch(`/api/accounts/invites/${revokeTarget.id}/revoke`, { method: "POST" })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setNotice(typeof j.error === "string" ? j.error : "Revoke failed.")
        return
      }
      await load()
    } catch {
      setNotice("Revoke failed.")
    } finally {
      setRevokeTarget(null)
      setRowBusyId(null)
    }
  }

  async function handleResend(account: AccountRow) {
    setRowBusyId(account.id)
    setNotice("")
    try {
      const res = await fetch(`/api/accounts/invites/${account.id}/resend`, { method: "POST" })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setNotice(typeof j.error === "string" ? j.error : "Resend failed.")
        return
      }
      setNotice(`Invite resent to ${account.email}.`)
      await load()
    } catch {
      setNotice("Resend failed.")
    } finally {
      setRowBusyId(null)
    }
  }

  const inviteTitle =
    inviteView === "fields" ? "Send invite"
    : inviteView === "person" ? "Person record"
    : inviteView === "link" ? "Link to an existing Person"
    : inviteView === "create" ? "Create a new Person"
    : "Account only"

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Accounts" />

      <main {...mainContentTargetProps} className="fc-surface-admin fc-scroll p-3 flex flex-col gap-3">

        <div className="rounded-xl bg-fc-panel px-4 py-3 text-sm text-gray-800 leading-relaxed">
          Invite someone by email. They set their own password from the invite link.
          An Account lets them sign in; a Person is who FamilyChart tracks medication and health for.
        </div>

        {!emailConfigured && (
          <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 leading-relaxed">
            Outbound email is not configured, so invites cannot be sent.
            Configure SMTP under{" "}
            <Link href="/admin/system-settings" className="underline font-medium">System Settings</Link>.
          </div>
        )}

        {notice && (
          <div className="rounded-xl bg-white/10 px-4 py-3 text-sm text-white leading-relaxed" role="status">
            {notice}
          </div>
        )}

        {loading && <p className="text-white text-center py-8">Loading…</p>}

        {!loading && accounts.length === 0 && (
          <p className="text-white text-center py-8">No accounts yet.</p>
        )}

        {!loading && accounts.map(a => {
          const status = accountInviteDisplayStatus(a)
          const busy = rowBusyId === a.id
          return (
            <div key={a.id} className="rounded-xl px-4 py-3 flex items-center gap-3 bg-white/10">
              <div className="flex-1 min-w-0">
                <div className="text-white font-bold truncate">{a.email}</div>
                <div className="text-white text-xs mt-0.5 flex gap-x-3 gap-y-1 flex-wrap items-center">
                  <span className={`rounded px-1.5 py-0.5 font-bold ${STATUS_BADGE_CLASS[status]}`}>
                    {STATUS_LABELS[status]}
                  </span>
                  {a.auth_method === "entra"
                    ? <span>Role from Entra</span>
                    : <span>Role: {ROLE_LABELS[a.role] ?? a.role}</span>}
                  <span>{a.can_report ? "Can access reports" : "Cannot access reports"}</span>
                  <span>{a.is_active ? "Can sign in" : "Sign-in disabled"}</span>
                  {a.auth_method === "local" && (
                    <span>{a.mfa_enrolled ? "MFA on" : "MFA pending"}</span>
                  )}
                  <span>Created {formatDate(a.created_at)}</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                {status === "invited" && (
                  <button
                    type="button"
                    onClick={() => setRevokeTarget(a)}
                    disabled={busy}
                    className="inline-flex items-center justify-center min-h-[44px] px-2 rounded-lg
                               text-red-300 hover:text-red-100 hover:bg-red-500/15 text-sm disabled:opacity-50"
                  >
                    Revoke
                  </button>
                )}
                {status !== "active" && (
                  <button
                    type="button"
                    onClick={() => void handleResend(a)}
                    disabled={busy || !emailConfigured}
                    className="inline-flex items-center justify-center min-h-[44px] px-2 rounded-lg
                               text-white hover:bg-white/10 text-sm disabled:opacity-50"
                  >
                    {busy ? "Working…" : "Resend"}
                  </button>
                )}
                <EntityRowEditButton onClick={() => openEdit(a)} disabled={busy} />
              </div>
            </div>
          )
        })}

        <button
          type="button"
          onClick={openInvite}
          disabled={!emailConfigured}
          className="bg-white hover:bg-gray-100 active:bg-gray-200 rounded-xl py-4 text-fc-blue font-bold text-center transition-colors disabled:opacity-50"
        >
          + Send invite
        </button>
      </main>

      <ConfirmModal
        open={mfaClearDlg}
        title="Remove authenticator?"
        message="They must set it up again on Profile before using the app."
        variant="warning"
        confirmLabel="Remove"
        onCancel={() => setMfaClearDlg(false)}
        onConfirm={() => void handleClearMfa()}
      />

      <ConfirmModal
        open={revokeTarget != null}
        title="Revoke invite?"
        message={revokeTarget ? `The invite to ${revokeTarget.email} will stop working. You can resend it later.` : ""}
        variant="warning"
        confirmLabel="Revoke"
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => void handleRevoke()}
      />

      <Modal
        open={inviteOpen}
        onClose={closeInvite}
        title={inviteTitle}
        panelClassName="bg-fc-panel rounded-2xl w-full max-w-md p-5 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
      >
        {inviteView === "fields" && (
          <>
            <div>
              <label className="text-sm font-bold text-gray-700 block mb-1">Email</label>
              <input
                type="email"
                value={invite.email}
                onChange={e => setInvite(f => ({ ...f, email: e.target.value }))}
                autoFocus
                autoComplete="off"
                className="w-full border border-gray-300 rounded px-3 py-2 text-gray-800"
              />
            </div>
            <div>
              <label className="text-sm font-bold text-gray-700 block mb-1">Role</label>
              <select
                value={invite.role}
                onChange={e => setInvite(f => ({ ...f, role: e.target.value }))}
                className="w-full border border-gray-300 rounded px-3 py-2 text-gray-800 bg-white"
              >
                {ROLES.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              {entraActive && (
                <p className="text-sm text-gray-600 mt-2 leading-relaxed">
                  If they sign in with Microsoft, their access level comes from Entra group membership instead.
                </p>
              )}
            </div>
            {saveErr && <p className="text-red-600 text-sm">{saveErr}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={closeInvite}
                className="flex-1 border border-gray-400 rounded-xl py-3 text-gray-700 font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { setSaveErr(""); setInviteView("person") }}
                disabled={!invite.email.trim()}
                className="flex-1 bg-fc-blue text-white font-bold rounded-xl py-3 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </>
        )}

        {inviteView === "person" && (
          <>
            <p className="text-sm text-gray-800 leading-relaxed font-bold">
              This invite creates an Account for {invite.email.trim() || "the invitee"}. Do they also need a Person record?
            </p>
            <p className="text-sm text-gray-600 leading-relaxed">
              An <strong>Account</strong> lets someone sign in. A <strong>Person</strong> is an entry FamilyChart tracks medication/health for — give someone a Person record if you want to log doses or observations for them.
            </p>
            <button
              type="button"
              onClick={() => { setSaveErr(""); setInviteView("link") }}
              className="text-left rounded-xl border border-gray-300 bg-white px-4 py-3 hover:bg-gray-50"
            >
              <div className="font-bold text-gray-800">Link to an existing Person</div>
              <div className="text-sm text-gray-600 mt-1">pick from the list (someone who already has a Person record but no Account yet)</div>
            </button>
            <button
              type="button"
              onClick={() => { setSaveErr(""); setInviteView("create") }}
              className="text-left rounded-xl border border-gray-300 bg-white px-4 py-3 hover:bg-gray-50"
            >
              <div className="font-bold text-gray-800">Create a new Person</div>
              <div className="text-sm text-gray-600 mt-1">for someone not yet in FamilyChart at all</div>
            </button>
            <button
              type="button"
              onClick={() => { setSaveErr(""); setInviteView("none") }}
              className="text-left rounded-xl border border-gray-300 bg-white px-4 py-3 hover:bg-gray-50"
            >
              <div className="font-bold text-gray-800">No — Account only</div>
            </button>
            <button
              type="button"
              onClick={() => setInviteView("fields")}
              className="border border-gray-400 rounded-xl py-3 text-gray-700 font-bold"
            >
              Back
            </button>
          </>
        )}

        {inviteView === "link" && (
          <>
            {unlinkedPeople.length === 0 ? (
              <p className="text-sm text-gray-600">No Person records without a linked Account.</p>
            ) : (
              <div>
                <label className="text-sm font-bold text-gray-700 block mb-1">Person</label>
                <select
                  value={invite.personId}
                  onChange={e => setInvite(f => ({ ...f, personId: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-gray-800 bg-white"
                >
                  <option value="">Select…</option>
                  {unlinkedPeople.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}
            {saveErr && <p className="text-red-600 text-sm">{saveErr}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setSaveErr(""); setInviteView("person") }}
                className="flex-1 border border-gray-400 rounded-xl py-3 text-gray-700 font-bold"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void submitInvite("link")}
                disabled={saving || !invite.personId}
                className="flex-1 bg-fc-blue text-white font-bold rounded-xl py-3 disabled:opacity-50"
              >
                {saving ? "Sending…" : "Send invite"}
              </button>
            </div>
          </>
        )}

        {inviteView === "create" && (
          <>
            <div>
              <label className="text-sm font-bold text-gray-700 block mb-1">Name</label>
              <input
                type="text"
                value={invite.personName}
                onChange={e => setInvite(f => ({ ...f, personName: e.target.value }))}
                autoFocus
                className="w-full border border-gray-300 rounded px-3 py-2 text-gray-800"
              />
            </div>
            {saveErr && <p className="text-red-600 text-sm">{saveErr}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setSaveErr(""); setInviteView("person") }}
                className="flex-1 border border-gray-400 rounded-xl py-3 text-gray-700 font-bold"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void submitInvite("create")}
                disabled={saving || !invite.personName.trim()}
                className="flex-1 bg-fc-blue text-white font-bold rounded-xl py-3 disabled:opacity-50"
              >
                {saving ? "Sending…" : "Send invite"}
              </button>
            </div>
          </>
        )}

        {inviteView === "none" && (
          <>
            <p className="text-sm text-gray-600 leading-relaxed">
              They will be able to sign in, with no Person record of their own.
            </p>
            {saveErr && <p className="text-red-600 text-sm">{saveErr}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setSaveErr(""); setInviteView("person") }}
                className="flex-1 border border-gray-400 rounded-xl py-3 text-gray-700 font-bold"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void submitInvite("none")}
                disabled={saving}
                className="flex-1 bg-fc-blue text-white font-bold rounded-xl py-3 disabled:opacity-50"
              >
                {saving ? "Sending…" : "Send invite"}
              </button>
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={editing != null}
        onClose={closeEdit}
        title="Edit Account"
      >
        {editing && (
          <>
            <div>
              <label className="text-sm font-bold text-gray-700 block mb-1">Email</label>
              <p className="text-gray-600 text-sm px-1">{editing.email}</p>
            </div>

            {editing.auth_method === "entra" ? (
              <p className="text-sm text-gray-600 leading-relaxed">
                This account signs in with Microsoft. Access level comes from Entra group membership — manage it in{" "}
                <Link href="/admin/access-control" className="underline font-medium text-fc-blue">Access Control</Link>.
              </p>
            ) : (
              <div>
                <label className="text-sm font-bold text-gray-700 block mb-1">Role</label>
                <select
                  value={editForm.role}
                  onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-gray-800 bg-white"
                >
                  {ROLES.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
            )}

            <Toggle
              label="Can access reports"
              value={editForm.can_report === 1}
              onChange={v => setEditForm(f => ({ ...f, can_report: v ? 1 : 0 }))}
            />

            <Toggle
              label="Account Active"
              value={editForm.is_active === 1}
              onChange={v => setEditForm(f => ({ ...f, is_active: v ? 1 : 0 }))}
            />

            {editing.auth_method === "local" && editing.mfa_enrolled === 1 && (
              <div>
                <button
                  type="button"
                  onClick={() => setMfaClearDlg(true)}
                  disabled={clearingMfa || saving}
                  className="w-full border border-amber-600 text-amber-800 rounded-xl py-2 text-sm font-bold
                             hover:bg-amber-50 disabled:opacity-50"
                >
                  {clearingMfa ? "Removing…" : "Remove authenticator (lockout recovery)"}
                </button>
              </div>
            )}

            {saveErr && <p className="text-red-600 text-sm">{saveErr}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={closeEdit}
                className="flex-1 border border-gray-400 rounded-xl py-3 text-gray-700 font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSaveEdit()}
                disabled={saving}
                className="flex-1 bg-fc-blue text-white font-bold rounded-xl py-3 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </>
        )}
      </Modal>

      <AppFooter />
    </div>
  )
}
