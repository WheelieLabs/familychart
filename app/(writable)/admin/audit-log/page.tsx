// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import { mainContentTargetProps } from "@/lib/a11y"

interface AuditRow {
  id: number
  user_email: string | null
  action: string
  entity_type: string
  entity_id: number | null
  details: string | null
  created_at: string
}

interface AuditPage {
  rows: AuditRow[]
  total: number
  limit: number
  offset: number
  actions: string[]
  entityTypes: string[]
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function formatDetails(raw: string | null): string {
  if (!raw) return "—"
  try {
    return JSON.stringify(JSON.parse(raw), null, 0)
  } catch {
    return raw
  }
}

interface Filters {
  actor: string
  action: string
  entity: string
  from: string
  to: string
}

const EMPTY_FILTERS: Filters = { actor: "", action: "", entity: "", from: "", to: "" }

export default function AdminAuditLogPage() {
  const [data, setData] = useState<AuditPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [offset, setOffset] = useState(0)
  const limit = 50

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams()
      params.set("limit", String(limit))
      params.set("offset", String(offset))
      if (filters.actor.trim()) params.set("actor", filters.actor.trim())
      if (filters.action) params.set("action", filters.action)
      if (filters.entity) params.set("entity", filters.entity)
      if (filters.from) params.set("from", filters.from)
      if (filters.to) params.set("to", filters.to)

      const res = await fetch(`/api/admin/audit-log?${params}`)
      if (!res.ok) {
        setError("Failed to load audit log")
        setData(null)
        return
      }
      setData(await res.json())
    } catch {
      setError("Failed to load audit log")
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [filters, offset])

  useEffect(() => { load() }, [load])

  function applyFilters(e: React.FormEvent) {
    e.preventDefault()
    setOffset(0)
    setFilters(draft)
  }

  const total = data?.total ?? 0
  const canPrev = offset > 0
  const canNext = offset + limit < total

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Audit Log" />
      <main {...mainContentTargetProps} className="fc-surface-admin fc-scroll p-3 flex flex-col gap-3">
        <div className="rounded-xl bg-fc-panel px-4 py-3 text-sm text-gray-800 leading-relaxed">
          Read-only trail of writes on this instance. Clinical measurement and dose values are not
          stored here — see entity ids and metadata only.{" "}
          <Link href="/admin/overview" className="underline font-medium text-fc-blue">
            Back to Administration
          </Link>
        </div>

        <form
          onSubmit={applyFilters}
          className="rounded-xl bg-white/10 px-4 py-3 flex flex-col gap-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 text-sm text-white">
              Actor email
              <input
                type="search"
                value={draft.actor}
                onChange={e => setDraft(d => ({ ...d, actor: e.target.value }))}
                className="rounded-lg px-3 py-2 text-gray-900 bg-white"
                placeholder="partial match"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-white">
              Action
              <select
                value={draft.action}
                onChange={e => setDraft(d => ({ ...d, action: e.target.value }))}
                className="rounded-lg px-3 py-2 text-gray-900 bg-white"
              >
                <option value="">All</option>
                {(data?.actions ?? []).map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-white">
              Entity
              <select
                value={draft.entity}
                onChange={e => setDraft(d => ({ ...d, entity: e.target.value }))}
                className="rounded-lg px-3 py-2 text-gray-900 bg-white"
              >
                <option value="">All</option>
                {(data?.entityTypes ?? []).map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-white">
              From
              <input
                type="date"
                value={draft.from}
                onChange={e => setDraft(d => ({ ...d, from: e.target.value }))}
                className="rounded-lg px-3 py-2 text-gray-900 bg-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-white">
              To
              <input
                type="date"
                value={draft.to}
                onChange={e => setDraft(d => ({ ...d, to: e.target.value }))}
                className="rounded-lg px-3 py-2 text-gray-900 bg-white"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-lg bg-fc-blue-mid hover:bg-fc-blue-dark text-white font-medium px-4 py-2 text-sm"
            >
              Apply filters
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(EMPTY_FILTERS)
                setFilters(EMPTY_FILTERS)
                setOffset(0)
              }}
              className="rounded-lg bg-white/20 hover:bg-white/30 text-white font-medium px-4 py-2 text-sm"
            >
              Clear
            </button>
          </div>
        </form>

        {error && <p className="text-red-200 text-sm px-1">{error}</p>}

        {loading && <p className="text-white text-center py-8">Loading…</p>}

        {!loading && data && data.rows.length === 0 && (
          <p className="text-white text-center py-8">No audit entries match these filters.</p>
        )}

        {!loading && data && data.rows.length > 0 && (
          <>
            <p className="text-white text-sm px-1">
              Showing {offset + 1}–{Math.min(offset + data.rows.length, total)} of {total}
            </p>
            <ul className="flex flex-col gap-2">
              {data.rows.map(row => (
                <li key={row.id} className="rounded-xl px-4 py-3 bg-white/10 text-white">
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm items-baseline">
                    <span className="font-bold">{row.action}</span>
                    <span className="text-white/90">{row.entity_type}</span>
                    {row.entity_id != null && (
                      <span className="text-white/80">#{row.entity_id}</span>
                    )}
                    <span className="text-white/80 ml-auto text-xs">{formatWhen(row.created_at)}</span>
                  </div>
                  <div className="text-sm mt-1 text-white/90">
                    {row.user_email || <span className="italic text-white/70">system</span>}
                  </div>
                  <div className="text-xs mt-1 font-mono break-all text-white/80">
                    {formatDetails(row.details)}
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex gap-2 justify-center pb-2">
              <button
                type="button"
                disabled={!canPrev}
                onClick={() => setOffset(o => Math.max(0, o - limit))}
                className="rounded-lg bg-white/20 hover:bg-white/30 disabled:opacity-40 text-white px-4 py-2 text-sm"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={!canNext}
                onClick={() => setOffset(o => o + limit)}
                className="rounded-lg bg-white/20 hover:bg-white/30 disabled:opacity-40 text-white px-4 py-2 text-sm"
              >
                Next
              </button>
            </div>
          </>
        )}
      </main>
      <AppFooter />
    </div>
  )
}
