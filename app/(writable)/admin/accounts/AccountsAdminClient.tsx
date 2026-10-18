// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import ConfirmModal from "@/components/ConfirmModal"
import Modal from "@/components/Modal"
import Badge, { type BadgeTone } from "@/components/ui/Badge"
import Banner, { type BannerKind } from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import { Input, Select, Toggle } from "@/components/ui/controls"
import EmptyState, { EMPTY_STATE_ICONS } from "@/components/ui/EmptyState"
import EntityRowActions from "@/components/ui/EntityRowActions"
import FormField from "@/components/ui/FormField"
import ListCard, { CardList } from "@/components/ui/ListCard"
import PageContainer from "@/components/ui/PageContainer"
import { formatDate } from "@/lib/date-format"
import { sqliteUtcToIso } from "@/lib/datetime"
import { accountStatus, isSignInManagedLocally, type AccountChip } from "@/lib/account/invite-status"
import { focusFirstInvalid } from "@/lib/ui/form-errors"
import { administrationTrail } from "@/lib/ui/breadcrumbs"
import { accountListCopy, HOUSEHOLD_ROLE_OPTIONS } from "@/lib/account/account-role-labels"
import { isNoneRole } from "@/lib/account/none-role"
import { LAST_LOCAL_ADMIN_ERROR } from "@/lib/account/last-local-admin"
import { ACCOUNT_STILL_LINKED_ERROR, OWN_ACCOUNT_ADMIN_ERROR } from "@/lib/account/account-removal-messages"
import RemoveAccountDialog from "@/components/RemoveAccountDialog"
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
  last_local_admin?: number
  has_personal_link?: number
}

interface EditForm {
  role: string
  can_report: number
  is_active: number
}

type InviteView = "fields" | "person" | "link" | "create" | "none"

const STATUS_CHIP: Record<AccountChip, { label: string; tone: BadgeTone }> = {
  disabled: { label: "Disabled", tone: "neutral" },
  active: { label: "Active", tone: "success" },
  invited: { label: "Invited", tone: "warning" },
  expired: { label: "Expired", tone: "neutral" },
  revoked: { label: "Revoked", tone: "error" },
}

function emptyInvite() {
  return { email: "", role: "read", personId: "", personName: "" }
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
  const [invite, setInvite] = useState(emptyInvite)
  const [editing, setEditing] = useState<AccountRow | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({ role: "read", can_report: 0, is_active: 1 })
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState("")
  const [notice, setNotice] = useState<{ kind: BannerKind; text: string } | null>(null)
  const [fieldErr, setFieldErr] = useState<{ email?: string; person?: string; name?: string }>({})
  const inviteBodyRef = useRef<HTMLDivElement>(null)
  const [errorTick, setErrorTick] = useState(0)
  const [clearingMfa, setClearingMfa] = useState(false)
  const [mfaClearDlg, setMfaClearDlg] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<AccountRow | null>(null)
  const [removeTarget, setRemoveTarget] = useState<AccountRow | null>(null)
  const [myEmail, setMyEmail] = useState("")
  const [rowBusyId, setRowBusyId] = useState<number | null>(null)

  // After a failed step, move focus to the first invalid field and announce it.
  useEffect(() => {
    if (errorTick > 0 && inviteBodyRef.current) focusFirstInvalid(inviteBodyRef.current)
  }, [errorTick])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [accountsRes, peopleRes, meRes] = await Promise.all([
        fetch("/api/accounts/invites"),
        fetch("/api/people"),
        fetch("/api/me"),
      ])
      if (accountsRes.ok) setAccounts(await accountsRes.json())
      if (peopleRes.ok) setPeople(await peopleRes.json())
      if (meRes.ok) {
        const me = await meRes.json() as { email?: string }
        setMyEmail(typeof me.email === "string" ? me.email : "")
      }
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
    setFieldErr({})
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
    if (!email) { setFieldErr({ email: "Enter an email address." }); setInviteView("fields"); setErrorTick(t => t + 1); return }
    if (personAction === "link" && !invite.personId) {
      setFieldErr({ person: "Pick a Person to link." }); setErrorTick(t => t + 1); return
    }
    if (personAction === "create" && !invite.personName.trim()) {
      setFieldErr({ name: "Enter the Person's name." }); setErrorTick(t => t + 1); return
    }
    setFieldErr({})
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
        setNotice({ kind: "warning", text: `Invite created, but the email did not send: ${j.emailError} Use Resend to try again.` })
      } else {
        setNotice(null)
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
      const body: Record<string, unknown> = { can_report: editForm.can_report }
      if (editing.auth_method !== "entra") body.role = editForm.role
      if (isSignInManagedLocally(editing.auth_method)) body.is_active = editForm.is_active
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
    setNotice(null)
    try {
      const res = await fetch(`/api/accounts/invites/${revokeTarget.id}/revoke`, { method: "POST" })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setNotice({ kind: "error", text: typeof j.error === "string" ? j.error : "Revoke failed." })
        return
      }
      await load()
    } catch {
      setNotice({ kind: "error", text: "Revoke failed." })
    } finally {
      setRevokeTarget(null)
      setRowBusyId(null)
    }
  }

  async function handleResend(account: AccountRow) {
    setRowBusyId(account.id)
    setNotice(null)
    try {
      const res = await fetch(`/api/accounts/invites/${account.id}/resend`, { method: "POST" })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setNotice({ kind: "error", text: typeof j.error === "string" ? j.error : "Resend failed." })
        return
      }
      setNotice({ kind: "success", text: `Invite resent to ${account.email}.` })
      await load()
    } catch {
      setNotice({ kind: "error", text: "Resend failed." })
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

  const sendLabel = saving ? "Sending…" : "Send invite"

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Accounts" />

      <PageContainer area="admin" trail={administrationTrail({ label: "Accounts" })}>
        <Banner kind="info">
          Invite someone by email. They set their own password from the invite link. An Account lets them sign in; a Person is who FamilyChart tracks medication and health for.
        </Banner>

        {!emailConfigured && (
          <Banner kind="warning">
            <>
              Outbound email is not configured, so invites cannot be sent. Configure SMTP under{" "}
              <Link href="/admin/system-settings">System Settings</Link>.
            </>
          </Banner>
        )}

        {notice && <Banner kind={notice.kind} announced>{notice.text}</Banner>}

        {loading && <p className="fc-admin-note">Loading…</p>}

        {!loading && accounts.length === 0 && (
          <EmptyState icon={EMPTY_STATE_ICONS.noAccounts} heading="No accounts yet">
            Send an invite to let someone sign in.
          </EmptyState>
        )}

        {!loading && accounts.length > 0 && (
          <CardList>
            {accounts.map(a => {
              const { invite, chip, disabled } = accountStatus(a)
              const listCopy = accountListCopy(a)
              const busy = rowBusyId === a.id
              return (
                <ListCard
                  key={a.id}
                  title={a.email}
                  meta={[
                    listCopy.role,
                    listCopy.reports,
                    a.auth_method === "local" && (a.mfa_enrolled ? "MFA on" : "MFA pending"),
                    `Created ${formatDate(sqliteUtcToIso(a.created_at))}`,
                  ]}
                  inactive={disabled}
                  extras={<Badge tone={STATUS_CHIP[chip].tone}>{STATUS_CHIP[chip].label}</Badge>}
                  trailing={
                    <div className="fc-account-actions">
                      {invite === "invited" && (
                        <Button variant="destructive" size="compact" onClick={() => setRevokeTarget(a)} pending={busy} pendingLabel="Working…" aria-label={`Revoke invite for ${a.email}`}>
                          Revoke
                        </Button>
                      )}
                      {invite !== "active" && (
                        emailConfigured ? (
                          <Button variant="secondary" size="compact" onClick={() => void handleResend(a)} pending={busy} pendingLabel="Working…" aria-label={`Resend invite to ${a.email}`}>
                            Resend
                          </Button>
                        ) : (
                          <Button variant="secondary" size="compact" disabled disabledReason="Email is not configured." aria-label={`Resend invite to ${a.email}`}>
                            Resend
                          </Button>
                        )
                      )}
                      <EntityRowActions name={a.email} onEdit={() => openEdit(a)} />
                      {(() => {
                        const reason = a.email.toLowerCase() === myEmail.toLowerCase() && myEmail
                          ? OWN_ACCOUNT_ADMIN_ERROR
                          : a.last_local_admin
                            ? LAST_LOCAL_ADMIN_ERROR
                            : a.has_personal_link
                              ? ACCOUNT_STILL_LINKED_ERROR
                              : null
                        return reason
                          ? (
                            <Button variant="destructive" size="compact" disabled disabledReason={reason} aria-label={`Remove ${a.email}`}>
                              Remove
                            </Button>
                          )
                          : (
                            <Button variant="destructive" size="compact" onClick={() => setRemoveTarget(a)} aria-label={`Remove ${a.email}`}>
                              Remove
                            </Button>
                          )
                      })()}
                    </div>
                  }
                />
              )
            })}
          </CardList>
        )}

        {emailConfigured ? (
          <Button fullWidth onClick={openInvite}>+ Send invite</Button>
        ) : (
          <Button fullWidth disabled disabledReason="Outbound email is not configured, so invites cannot be sent.">
            + Send invite
          </Button>
        )}
      </PageContainer>

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
        <div ref={inviteBodyRef} className="fc-form">
          {inviteView === "fields" && (
            <>
              <FormField label="Email" error={fieldErr.email}>
                <Input
                  type="email"
                  value={invite.email}
                  onChange={e => setInvite(f => ({ ...f, email: e.target.value }))}
                  autoFocus
                  autoComplete="off"
                />
              </FormField>
              <FormField
                label="Role"
                hint={
                  [
                    isNoneRole(invite.role) ? "Access is the Personal-link only." : "",
                    entraActive ? "If they sign in with Microsoft, their access level comes from Entra group membership instead." : "",
                  ].filter(Boolean).join(" ") || undefined
                }
              >
                <Select value={invite.role} onChange={e => setInvite(f => ({ ...f, role: e.target.value }))}>
                  {HOUSEHOLD_ROLE_OPTIONS.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </Select>
              </FormField>
              {saveErr && <Banner kind="error">{saveErr}</Banner>}
              <div className="fc-form-actions">
                <Button variant="secondary" onClick={closeInvite}>Cancel</Button>
                {invite.email.trim() ? (
                  <Button onClick={() => { setSaveErr(""); setFieldErr({}); setInviteView("person") }}>Next</Button>
                ) : (
                  <Button disabled disabledReason="Enter an email address first.">Next</Button>
                )}
              </div>
            </>
          )}

          {inviteView === "person" && (
            <>
              <p className="fc-section-copy">
                <strong>This invite creates an Account for {invite.email.trim() || "the invitee"}. Do they also need a Person record?</strong>
              </p>
              <p className="fc-section-copy">
                An <strong>Account</strong> lets someone sign in. A <strong>Person</strong> is an entry FamilyChart tracks medication/health for — give someone a Person record if you want to log doses or observations for them.
              </p>
              <Button variant="secondary" fullWidth onClick={() => { setSaveErr(""); setInviteView("link") }}>
                Link to an existing Person
              </Button>
              <p className="fc-field__hint">Pick from the list (someone who already has a Person record but no Account yet).</p>
              <Button variant="secondary" fullWidth onClick={() => { setSaveErr(""); setInviteView("create") }}>
                Create a new Person
              </Button>
              <p className="fc-field__hint">For someone not yet in FamilyChart at all.</p>
              {!isNoneRole(invite.role) && (
                <Button variant="secondary" fullWidth onClick={() => { setSaveErr(""); setInviteView("none") }}>
                  No — Account only
                </Button>
              )}
              <Button variant="quiet" onClick={() => setInviteView("fields")}>Back</Button>
            </>
          )}

          {inviteView === "link" && (
            <>
              {unlinkedPeople.length === 0 ? (
                <p className="fc-section-copy">No Person records without a linked Account.</p>
              ) : (
                <FormField label="Person" error={fieldErr.person}>
                  <Select value={invite.personId} onChange={e => setInvite(f => ({ ...f, personId: e.target.value }))}>
                    <option value="">Select…</option>
                    {unlinkedPeople.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                </FormField>
              )}
              {saveErr && <Banner kind="error">{saveErr}</Banner>}
              <div className="fc-form-actions">
                <Button variant="secondary" onClick={() => { setSaveErr(""); setFieldErr({}); setInviteView("person") }}>Back</Button>
                <Button onClick={() => void submitInvite("link")} pending={saving} pendingLabel="Sending…">{sendLabel}</Button>
              </div>
            </>
          )}

          {inviteView === "create" && (
            <>
              <FormField label="Name" error={fieldErr.name}>
                <Input
                  type="text"
                  value={invite.personName}
                  onChange={e => setInvite(f => ({ ...f, personName: e.target.value }))}
                  autoFocus
                />
              </FormField>
              {saveErr && <Banner kind="error">{saveErr}</Banner>}
              <div className="fc-form-actions">
                <Button variant="secondary" onClick={() => { setSaveErr(""); setFieldErr({}); setInviteView("person") }}>Back</Button>
                <Button onClick={() => void submitInvite("create")} pending={saving} pendingLabel="Sending…">{sendLabel}</Button>
              </div>
            </>
          )}

          {inviteView === "none" && (
            <>
              <p className="fc-section-copy">They will be able to sign in, with no Person record of their own.</p>
              {saveErr && <Banner kind="error">{saveErr}</Banner>}
              <div className="fc-form-actions">
                <Button variant="secondary" onClick={() => { setSaveErr(""); setInviteView("person") }}>Back</Button>
                <Button onClick={() => void submitInvite("none")} pending={saving} pendingLabel="Sending…">{sendLabel}</Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal open={editing != null} onClose={closeEdit} title="Edit Account">
        {editing && (
          <div className="fc-form">
            <FormField label="Email">
              <Input type="email" value={editing.email} readOnly />
            </FormField>

            {editing.auth_method === "entra" ? (
              <p className="fc-section-copy">
                This account signs in with Microsoft. Access level comes from Entra group membership — manage it in{" "}
                <Link href="/admin/access-control">Access Control</Link>.
              </p>
            ) : (
              <FormField label="Role">
                <Select
                  value={editForm.role}
                  onChange={e => {
                    const role = e.target.value
                    setEditForm(f => ({
                      ...f,
                      role,
                      can_report: isNoneRole(role) ? 0 : f.can_report,
                    }))
                  }}
                >
                  {HOUSEHOLD_ROLE_OPTIONS.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </Select>
              </FormField>
            )}

            {isNoneRole(editForm.role) ? (
              <Toggle
                label="Can access reports"
                checked={editForm.can_report === 1}
                disabled
                disabledReason="Household Reports needs a household Role. They can still report on their Personal-linked Person."
                onChange={v => setEditForm(f => ({ ...f, can_report: v ? 1 : 0 }))}
              />
            ) : (
              <Toggle
                label="Can access reports"
                checked={editForm.can_report === 1}
                onChange={v => setEditForm(f => ({ ...f, can_report: v ? 1 : 0 }))}
              />
            )}

            {!isSignInManagedLocally(editing.auth_method) ? (
              <p className="fc-section-copy">
                Sign-in for this account is controlled in Entra. See{" "}
                <Link href="/admin/access-control">Access Control</Link> and{" "}
                <Link href="/admin/entra-sessions">Entra Sessions</Link>.
              </p>
            ) : editing.last_local_admin ? (
              <Toggle
                label="Sign-in enabled"
                hint="Turning this off blocks sign-in immediately."
                checked={editForm.is_active === 1}
                disabled
                disabledReason={LAST_LOCAL_ADMIN_ERROR}
                onChange={v => setEditForm(f => ({ ...f, is_active: v ? 1 : 0 }))}
              />
            ) : (
              <Toggle
                label="Sign-in enabled"
                hint="Turning this off blocks sign-in immediately."
                checked={editForm.is_active === 1}
                onChange={v => setEditForm(f => ({ ...f, is_active: v ? 1 : 0 }))}
              />
            )}

            {editing.auth_method === "local" && editing.mfa_enrolled === 1 && (
              <Button variant="destructive" fullWidth onClick={() => setMfaClearDlg(true)} pending={clearingMfa} pendingLabel="Removing…">
                Remove authenticator (lockout recovery)
              </Button>
            )}

            {saveErr && <Banner kind="error">{saveErr}</Banner>}

            <div className="fc-form-actions">
              <Button variant="secondary" onClick={closeEdit}>Cancel</Button>
              {editing.last_local_admin && (editForm.role !== "admin" || editForm.is_active === 0) ? (
                <Button disabled disabledReason={LAST_LOCAL_ADMIN_ERROR} pending={saving}>Save changes</Button>
              ) : (
                <Button onClick={() => void handleSaveEdit()} pending={saving}>Save changes</Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {removeTarget && (
        <RemoveAccountDialog
          accountId={removeTarget.id}
          onClose={() => setRemoveTarget(null)}
          onRemoved={() => { setRemoveTarget(null); void load() }}
        />
      )}

      <AppFooter />
    </div>
  )
}
