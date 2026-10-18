// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useEffect, useState } from "react"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import ConfirmModal from "@/components/ConfirmModal"
import EntraRevalidationGapBanner from "@/components/EntraRevalidationGapBanner"
import Badge from "@/components/ui/Badge"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import EmptyState, { EMPTY_STATE_ICONS } from "@/components/ui/EmptyState"
import ListCard, { CardList } from "@/components/ui/ListCard"
import PageContainer from "@/components/ui/PageContainer"
import type { EntraRevalidationGap } from "@/lib/auth/entra-revalidation-gap"
import { formatDateTime } from "@/lib/date-format"
import { administrationTrail } from "@/lib/ui/breadcrumbs"

interface EntraSessionRow {
  provider: string
  externalId: string
  status: "ok" | "revoked"
  lastCheckedAt: number | null
  groups: string[] | null
  email: string | null
  displayName: string | null
  updatedAt: number
}

function formatLastChecked(ms: number | null): string {
  if (ms == null) return "Never revalidated yet"
  return formatDateTime(ms)
}

export default function AdminEntraSessionsPage() {
  const [sessions, setSessions] = useState<EntraSessionRow[]>([])
  const [gap, setGap] = useState<EntraRevalidationGap | null>(null)
  const [emailAlertsOff, setEmailAlertsOff] = useState(false)
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState(false)
  const [revokeErr, setRevokeErr] = useState("")
  const [confirmTarget, setConfirmTarget] = useState<EntraSessionRow | null>(null)
  const [removed, setRemoved] = useState<{ id: string; removed_at: string }[]>([])
  const [allowingId, setAllowingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [res, removedRes] = await Promise.all([
        fetch("/api/admin/entra-sessions"),
        fetch("/api/admin/entra-removed"),
      ])
      if (res.ok) {
        const data = await res.json()
        setSessions(data.sessions ?? [])
        setGap(data.revalidationGap ?? null)
        setEmailAlertsOff(data.outboundEmailConfigured === false)
      }
      if (removedRes.ok) {
        const data = await removedRes.json()
        setRemoved(data.accounts ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleRevoke() {
    if (!confirmTarget) return
    setRevoking(true)
    setRevokeErr("")
    try {
      const res = await fetch(`/api/admin/entra-sessions/${encodeURIComponent(confirmTarget.externalId)}/revoke`, {
        method: "POST",
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setRevokeErr(typeof j.error === "string" ? j.error : "Request failed.")
        return
      }
      setConfirmTarget(null)
      await load()
    } catch {
      setRevokeErr("Request failed.")
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Entra Sessions" />

      <PageContainer area="admin" trail={administrationTrail({ label: "Entra Sessions" })}>
        <Banner kind="info">
          Microsoft Entra sign-ins tracked on this instance. A background check revalidates each account against Entra roughly hourly; revoking here takes effect immediately on the user's next request, with no dependency on that check running first.
        </Banner>

        {gap && <EntraRevalidationGapBanner gap={gap} variant="full" emailAlertsOff={emailAlertsOff} />}

        {revokeErr && <Banner kind="error">{revokeErr}</Banner>}

        {loading && <p className="fc-admin-note">Loading…</p>}

        {!loading && sessions.length === 0 && (
          <EmptyState icon={EMPTY_STATE_ICONS.noSessions} heading="No sign-ins yet">
            Entra sign-ins appear here once someone signs in with Microsoft.
          </EmptyState>
        )}

        {!loading && (
          <CardList>
            {sessions.map(s => (
              <ListCard
                key={s.externalId}
                title={s.displayName || s.email || s.externalId}
                meta={[s.email, `Last revalidated: ${formatLastChecked(s.lastCheckedAt)}`]}
                extras={<Badge tone={s.status === "revoked" ? "error" : "success"}>{s.status === "revoked" ? "Revoked" : "Active"}</Badge>}
                trailing={
                  s.status !== "revoked" ? (
                    <Button variant="destructive" onClick={() => setConfirmTarget(s)} aria-label={`Revoke ${s.displayName || s.email || s.externalId}`}>
                      Revoke
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </CardList>
        )}

        {removed.length > 0 && (
          <>
            <h2 className="fc-section-title">Removed accounts</h2>
            <p className="fc-section-copy">
              These people are still in the Entra group, but their account on this instance was removed. Allowing them back lets the next sign-in create it again.
            </p>
            <CardList>
              {removed.map(row => (
                <ListCard
                  key={row.id}
                  title="Removed account"
                  meta={[`Removed ${formatDateTime(row.removed_at)}`]}
                  trailing={
                    <Button
                      pending={allowingId === row.id}
                      pendingLabel="Allowing…"
                      onClick={() => {
                        setAllowingId(row.id)
                        void fetch("/api/admin/entra-removed", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ id: row.id }),
                        }).then(async res => {
                          if (res.ok) await load()
                        }).finally(() => setAllowingId(null))
                      }}
                    >
                      Allow this person back
                    </Button>
                  }
                />
              ))}
            </CardList>
          </>
        )}
      </PageContainer>

      <ConfirmModal
        open={confirmTarget != null}
        title="Revoke this session?"
        message={`${confirmTarget?.displayName || confirmTarget?.email || "This user"} will be signed out on their next request. They can sign back in only if their Entra account is still enabled.`}
        variant="danger"
        confirmLabel={revoking ? "Revoking…" : "Revoke"}
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => void handleRevoke()}
      />

      <AppFooter />
    </div>
  )
}
