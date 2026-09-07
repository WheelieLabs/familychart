// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useEffect, useState } from "react"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import ConfirmModal from "@/components/ConfirmModal"
import { mainContentTargetProps } from "@/lib/a11y"

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
  return new Date(ms).toLocaleString("en-AU", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  })
}

export default function AdminEntraSessionsPage() {
  const [sessions, setSessions] = useState<EntraSessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState(false)
  const [revokeErr, setRevokeErr] = useState("")
  const [confirmTarget, setConfirmTarget] = useState<EntraSessionRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/entra-sessions")
      if (res.ok) {
        const data = await res.json()
        setSessions(data.sessions ?? [])
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

      <main {...mainContentTargetProps} className="fc-surface-admin fc-scroll p-3 flex flex-col gap-3">
        <div className="rounded-xl bg-fc-panel px-4 py-3 text-sm text-gray-800 leading-relaxed">
          Microsoft Entra sign-ins tracked on this instance. A background check revalidates each
          account against Entra roughly hourly; revoking here takes effect immediately on the
          user&apos;s next request, with no dependency on that check running first.
        </div>

        {revokeErr && <p className="text-red-200 text-sm px-1">{revokeErr}</p>}

        {loading && <p className="text-white text-center py-8">Loading…</p>}

        {!loading && sessions.length === 0 && (
          <p className="text-white text-center py-8">No Entra sign-ins tracked yet.</p>
        )}

        {!loading && sessions.map(s => (
          <div key={s.externalId} className="rounded-xl px-4 py-3 flex items-center gap-3 bg-white/10">
            <div className="flex-1 min-w-0">
              <div className="text-white font-bold truncate">
                {s.displayName || s.email || s.externalId}
              </div>
              <div className="text-white text-xs mt-0.5 flex gap-x-3 gap-y-1 flex-wrap items-center">
                {s.email && <span>{s.email}</span>}
                <span className={s.status === "revoked" ? "text-red-300 font-bold" : ""}>
                  {s.status === "revoked" ? "Revoked" : "Active"}
                </span>
                <span>Last revalidated: {formatLastChecked(s.lastCheckedAt)}</span>
              </div>
            </div>
            {s.status !== "revoked" && (
              <button
                type="button"
                onClick={() => setConfirmTarget(s)}
                className="border border-red-300 text-red-100 hover:bg-red-600/30 active:bg-red-600/50
                           rounded-lg px-3 py-2 text-sm font-bold transition-colors shrink-0"
              >
                Revoke
              </button>
            )}
          </div>
        ))}
      </main>

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
