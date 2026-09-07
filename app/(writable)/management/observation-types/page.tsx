// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useEffect, useState } from "react"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import ConfirmModal, { type ConfirmVariant } from "@/components/ConfirmModal"
import {
  CatalogActiveStatusButton,
  InactiveCatalogBadge,
} from "@/components/EntityRowActions"
import type { ObservationTypeConfig } from "@/lib/domain-types"
import { mainContentTargetProps } from "@/lib/a11y"
import { formatCount } from "@/lib/format-count"

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

      <main {...mainContentTargetProps} className="fc-surface-app fc-scroll flex flex-col min-h-0">
        <div className="flex flex-col gap-3 p-3 flex-1">
          <div className="rounded-xl bg-fc-panel px-4 py-3 text-sm text-gray-800 leading-relaxed space-y-2">
            <p>
              Per-person schedules live on each family member&apos;s{" "}
              <strong className="font-bold text-gray-900">Observation Reminders</strong> screen from
              the home menu.
            </p>
            <p className="text-xs text-gray-600 leading-relaxed">
              This is the curated observation catalogue. Toggle types active or inactive for this
              household — chart defaults, units, and age caps come with the app and cannot be edited
              here.
            </p>
          </div>

          {loading && <p className="text-white/80 text-center py-8">Loading…</p>}

          {!loading && configs.length === 0 && (
            <p className="text-white/70 text-center py-8">No Observation Types configured.</p>
          )}

          {!loading &&
            configs.map(c => (
              <div
                key={c.id}
                className={`rounded-xl px-4 py-3 flex items-center gap-3 ${
                  c.is_active ? "bg-white/10" : "bg-white/5"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-bold truncate">{c.observation_type}</span>
                    {c.is_active === 0 && <InactiveCatalogBadge />}
                  </div>
                  <div className="text-white/60 text-xs mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>{c.is_static ? "Static" : "Repeated"}</span>
                    <span>{c.chart_type === "line" ? "Line chart" : c.chart_type === "bar" ? "Bar chart" : "Table only"}</span>
                    <span>Unit {c.typical_unit ?? "—"}</span>
                    <span>
                      Max age{" "}
                      {c.max_age_years != null ? formatCount(c.max_age_years, "yr") : "—"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <CatalogActiveStatusButton
                    active={c.is_active === 1}
                    disabled={togglingId === c.id}
                    aria-label={
                      c.is_active === 1
                        ? `Deactivate ${c.observation_type}`
                        : `Activate ${c.observation_type}`
                    }
                    onClick={() => void handleToggleActive(c)}
                  />
                </div>
              </div>
            ))}
        </div>
      </main>

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
