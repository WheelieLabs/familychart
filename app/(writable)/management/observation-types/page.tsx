// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useEffect, useState } from "react"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import ConfirmModal, { type ConfirmVariant } from "@/components/ConfirmModal"
import Badge from "@/components/ui/Badge"
import Banner from "@/components/ui/Banner"
import { Toggle } from "@/components/ui/controls"
import EmptyState, { EMPTY_STATE_ICONS } from "@/components/ui/EmptyState"
import ListCard, { CardList } from "@/components/ui/ListCard"
import PageContainer from "@/components/ui/PageContainer"
import type { ObservationTypeConfig } from "@/lib/domain-types"
import { formatCount } from "@/lib/format-count"
import { managementTrail } from "@/lib/ui/breadcrumbs"

function chartLabel(chartType: string): string {
  if (chartType === "line") return "Line chart"
  if (chartType === "bar") return "Bar chart"
  return "Table only"
}

export default function ManagementObservationTypesPage() {
  const [configs, setConfigs] = useState<ObservationTypeConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [togglingId, setTogglingId] = useState<number | null>(null)

  const [confirmDlg, setConfirmDlg] = useState<null | {
    title: string
    message: string
    detail?: string
    variant: ConfirmVariant
    confirmLabel?: string
    showCancel?: boolean
    onConfirm: () => void | Promise<void>
  }>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const cfgRes = await fetch("/api/observation-type-config")
      if (cfgRes.ok) setConfigs(await cfgRes.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleToggleActive(c: ObservationTypeConfig) {
    const nextActive = c.is_active === 1 ? 0 : 1
    setTogglingId(c.id)
    try {
      const res = await fetch(`/api/observation-type-config/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: nextActive }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setConfirmDlg({
          title: nextActive ? "Could not activate" : "Could not deactivate",
          message: typeof j.error === "string" ? j.error : "Request failed.",
          variant: "danger",
          showCancel: false,
          confirmLabel: "OK",
          onConfirm: () => setConfirmDlg(null),
        })
        return
      }
      await load()
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Observation Types" />

      <PageContainer trail={managementTrail({ label: "Observation Types" })}>
        <Banner kind="info" lead="Where schedules live">
          Per-person schedules are under Schedules &amp; Goals › Observations on each family member&apos;s
          page. This is the curated observation catalogue: switch types on or off for this household.
          Chart defaults, units and age caps come with the app and cannot be edited here.
        </Banner>

        {loading && <p className="fc-admin-note">Loading…</p>}

        {!loading && configs.length === 0 && (
          <EmptyState icon={EMPTY_STATE_ICONS.noObservationTypes} heading="No observation types">
            The catalogue is empty. Observation types come with the app.
          </EmptyState>
        )}

        <CardList>
          {configs.map(c => (
            <ListCard
              key={c.id}
              title={c.observation_type}
              inactive={c.is_active === 0}
              extras={c.is_active === 0 ? <Badge tone="neutral">Inactive</Badge> : undefined}
              meta={[
                c.is_static ? "Static" : "Repeated",
                chartLabel(c.chart_type),
                `Unit ${c.typical_unit ?? "—"}`,
                `Max age ${c.max_age_years != null ? formatCount(c.max_age_years, "yr") : "—"}`,
              ]}
              trailing={
                <Toggle
                  label="Active"
                  checked={c.is_active === 1}
                  disabled={togglingId === c.id}
                  disabledReason="Saving…"
                  onChange={() => void handleToggleActive(c)}
                />
              }
            />
          ))}
        </CardList>
      </PageContainer>

      {confirmDlg && (
        <ConfirmModal
          open
          title={confirmDlg.title}
          message={confirmDlg.message}
          detail={confirmDlg.detail}
          variant={confirmDlg.variant}
          confirmLabel={confirmDlg.confirmLabel}
          showCancel={confirmDlg.showCancel ?? true}
          onCancel={() => setConfirmDlg(null)}
          onConfirm={confirmDlg.onConfirm}
        />
      )}

      <AppFooter />
    </div>
  )
}
