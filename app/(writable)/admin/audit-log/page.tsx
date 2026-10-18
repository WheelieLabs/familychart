// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useEffect, useState } from "react"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import EmptyState, { EMPTY_STATE_ICONS } from "@/components/ui/EmptyState"
import { Input, Select } from "@/components/ui/controls"
import FormField from "@/components/ui/FormField"
import ListCard, { CardList } from "@/components/ui/ListCard"
import PageContainer from "@/components/ui/PageContainer"
import Panel from "@/components/ui/Panel"
import { displayAccountActor } from "@/lib/account/removed-account-label"
import { formatDateTime } from "@/lib/date-format"
import { sqliteUtcToIso } from "@/lib/datetime"
import { administrationTrail } from "@/lib/ui/breadcrumbs"

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

function formatWhen(stored: string): string {
  return formatDateTime(sqliteUtcToIso(stored), { seconds: true })
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
      <PageContainer area="admin" trail={administrationTrail({ label: "Audit Log" })}>
        <Banner kind="info">
          Read-only trail of writes on this instance. Clinical measurement and dose values are not stored here — see entity ids and metadata only.
        </Banner>

        <Panel as="form" onSubmit={applyFilters}>
          <div className="fc-form-grid">
            <FormField label="Actor email" hint="Partial match">
              <Input type="search" value={draft.actor} onChange={e => setDraft(d => ({ ...d, actor: e.target.value }))} />
            </FormField>
            <FormField label="Action">
              <Select value={draft.action} onChange={e => setDraft(d => ({ ...d, action: e.target.value }))}>
                <option value="">All</option>
                {(data?.actions ?? []).map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Entity">
              <Select value={draft.entity} onChange={e => setDraft(d => ({ ...d, entity: e.target.value }))}>
                <option value="">All</option>
                {(data?.entityTypes ?? []).map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="From">
              <Input type="date" value={draft.from} onChange={e => setDraft(d => ({ ...d, from: e.target.value }))} />
            </FormField>
            <FormField label="To">
              <Input type="date" value={draft.to} onChange={e => setDraft(d => ({ ...d, to: e.target.value }))} />
            </FormField>
          </div>
          <div className="fc-form-actions">
            <Button type="submit" size="compact">Apply filters</Button>
            <Button
              variant="secondary"
              size="compact"
              onClick={() => {
                setDraft(EMPTY_FILTERS)
                setFilters(EMPTY_FILTERS)
                setOffset(0)
              }}
            >
              Clear
            </Button>
          </div>
        </Panel>

        {error && <Banner kind="error">{error}</Banner>}

        {loading && <p className="fc-admin-note">Loading…</p>}

        {!loading && data && data.rows.length === 0 && (
          <EmptyState icon={EMPTY_STATE_ICONS.noAuditEntries} heading="No entries">
            No audit entries match these filters. Try widening them.
          </EmptyState>
        )}

        {!loading && data && data.rows.length > 0 && (
          <>
            <p className="fc-export-note">
              Showing {offset + 1}–{Math.min(offset + data.rows.length, total)} of {total}
            </p>
            <CardList>
              {data.rows.map(row => (
                <ListCard
                  key={row.id}
                  title={row.action}
                  meta={[
                    row.entity_id != null ? `${row.entity_type} #${row.entity_id}` : row.entity_type,
                    displayAccountActor(row.user_email),
                    formatWhen(row.created_at),
                  ]}
                  extras={<code className="fc-audit-details">{formatDetails(row.details)}</code>}
                />
              ))}
            </CardList>
            <div className="fc-form-actions">
              {canPrev && (
                <Button variant="secondary" size="compact" onClick={() => setOffset(o => Math.max(0, o - limit))}>
                  Previous
                </Button>
              )}
              {canNext && (
                <Button variant="secondary" size="compact" onClick={() => setOffset(o => o + limit)}>
                  Next
                </Button>
              )}
            </div>
          </>
        )}
      </PageContainer>
      <AppFooter />
    </div>
  )
}
