// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import BackButton from "@/components/BackButton"
import type { DashboardPersonStatus, DashboardStatus } from "@/lib/dashboard/dashboard-status"
import { dashboardScheduleHeaders } from "@/lib/dashboard/dashboard-client-context"
import { formatHydration } from "@/lib/format"
import { hydrationPacingHint } from "@/lib/hydration/hydration-pacing-copy"
import { mainContentTargetProps } from "@/lib/a11y"

const STATUS_EMOJI: Record<DashboardStatus, string> = {
  red: "🔴",
  amber: "🟡",
  green: "🟢",
}

interface Props {
  personId: number
  name: string
  photoUrl?: string | null
  color?: string
  canWrite: boolean
  /** Linked self-user viewing their own person — enables hydration mute. */
  isLinkedViewer: boolean
}

type ActionCard = { href: string; icon: string; title: string; description: string }

const tileClass =
  "rounded-xl p-5 min-h-[80px] flex flex-col gap-3 bg-fc-blue-mid hover:bg-fc-blue-dark active:bg-fc-blue-dark shadow-md cursor-pointer transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"

const cardClass = "bg-fc-blue-mid rounded-xl overflow-hidden shadow-md"

export default function PersonPageActions({ personId, name, photoUrl, color = "#256AA5", canWrite, isLinkedViewer }: Props) {
  const [dashboard, setDashboard] = useState<DashboardPersonStatus[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [muting, setMuting] = useState(false)

  function loadDashboard(cancelled?: () => boolean) {
    return fetch("/api/dashboard", { cache: "no-store", headers: dashboardScheduleHeaders() })
      .then(r => {
        if (!r.ok) throw new Error("dashboard fetch failed")
        return r.json() as Promise<DashboardPersonStatus[]>
      })
      .then(data => {
        if (cancelled?.()) return
        setDashboard(data)
        setFailed(false)
      })
      .catch(() => {
        if (cancelled?.()) return
        setFailed(true)
      })
  }

  async function muteHydrationToday() {
    if (muting) return
    setMuting(true)
    try {
      const res = await fetch("/api/me/hydration-mute", { method: "POST", credentials: "include" })
      if (!res.ok) throw new Error("mute failed")
      await loadDashboard()
    } catch {
      setFailed(true)
    } finally {
      setMuting(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    const isCancelled = () => cancelled
    function load() {
      void loadDashboard(isCancelled)
    }
    load()
    const onVisible = () => {
      if (document.visibilityState === "visible") load()
    }
    window.addEventListener("focus", load)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      window.removeEventListener("focus", load)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  const entry = useMemo(() => {
    if (!dashboard) return undefined
    return dashboard.find(d => d.personId === personId)
  }, [dashboard, personId])

  const cards: ActionCard[] = useMemo(() => {
    const out: ActionCard[] = []
    if (canWrite) {
      out.push(
        {
          href: `/${personId}/record-medication`,
          icon: "💊",
          title: "Record Medication",
          description: "Log a dose with time",
        },
        {
          href: `/${personId}/record-observation`,
          icon: "📊",
          title: "Record Observation",
          description: "Add a health measurement",
        }
      )
    }
    out.push({
      href: `/${personId}/history`,
      icon: "📜",
      title: "History",
      description: "Medication and observation timeline",
    })
    if (canWrite) {
      out.push({
        href: `/${personId}/schedules-goals`,
        icon: "🗓️",
        title: "Schedules & Goals",
        description: "Schedules, reminders and goals",
      })
    }
    return out
  }, [personId, canWrite])

  const initials = name
    .split(" ")
    .map(w => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  const hasAlerts = (entry?.alerts ?? []).length > 0
  // Worst-of-all-rows accent is intentional: a single red row should draw
  // attention to the whole card, not just its own row.
  const maxSeverity = entry?.alerts.some(a => a.severity === "red") ? "red" : "amber"
  const accentBorder = !hasAlerts ? "border-white/20"
    : maxSeverity === "red" ? "border-red-500" : "border-amber-400"

  return (
    <>
      <div className="bg-fc-blue px-4 py-4 flex items-start gap-4 shrink-0">
        <div
          className="w-16 h-16 rounded-full border-[3px] border-fc-ring flex items-center justify-center overflow-hidden shrink-0"
          style={{ backgroundColor: color }}
        >
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt={name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-white font-bold text-lg">{initials}</span>
          )}
        </div>
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 min-w-0">
            <span className="text-white font-bold text-2xl shrink-0">{name}</span>
          </div>
          {!failed && dashboard === null ? (
            <span className="text-sm text-white">Status updating…</span>
          ) : failed ? (
            <span className="text-sm text-white">Dashboard status could not be loaded.</span>
          ) : entry ? (
            entry.alerts.length > 0 ? (
              <span className="text-sm text-white flex items-center gap-1.5">
                <span className="text-[1.15em]" aria-hidden>{STATUS_EMOJI[maxSeverity]}</span>
                {entry.summary}
              </span>
            ) : (
              <span className="text-sm text-white">
                <span className="text-[1.15em]" aria-hidden>{STATUS_EMOJI[entry.status]}</span>{" "}
                {entry.summary}
              </span>
            )
          ) : null}
        </div>
        <BackButton href="/" className="shrink-0" />
      </div>

      {/* Alert panel — fixed height in all states so the action grid below never shifts. */}
      <div className="shrink-0 mx-4 mt-3">
        <div className={`${cardClass} border-l-[3px] ${accentBorder} relative`}>
          <div
            className="h-[156px] overflow-y-scroll flex flex-col
                       [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.3)_transparent]
                       [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-white/30
                       [&::-webkit-scrollbar-track]:bg-transparent"
            role="region"
            aria-label="Alerts"
          >
            {!hasAlerts ? (
              <div className="flex-1 flex items-center justify-center px-4 py-5 text-center">
                <span className="text-white text-sm">✓ No alerts — nothing due right now</span>
              </div>
            ) : (
              (entry?.alerts ?? []).map((alert, i, arr) => {
                const isLast = i === arr.length - 1
                const rowClass = `flex items-start gap-3 px-4 py-3${isLast ? "" : " border-b border-white/10"}`
                const isHydrationAlert = alert.detail.name === "Hydration" && alert.action_url != null
                const actionBtnClass =
                  "text-sm text-sky-100 shrink-0 self-center px-2 py-1 rounded-md hover:bg-white/10 active:bg-white/15 transition-colors"

                if (isHydrationAlert) {
                  return (
                    <div key={i} className={rowClass}>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-white leading-snug">{alert.detail.name}</div>
                        <div className="text-sm text-white leading-snug mt-0.5 flex items-center gap-1">
                          <span className="text-[1.15em]" aria-hidden>{STATUS_EMOJI[alert.severity]}</span>
                          {alert.detail.sub}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 self-center">
                        <Link href={alert.action_url!} className={actionBtnClass}>
                          Record
                        </Link>
                        {isLinkedViewer && (
                          <button
                            type="button"
                            onClick={() => void muteHydrationToday()}
                            disabled={muting}
                            className={`${actionBtnClass} disabled:opacity-50`}
                          >
                            {muting ? "Muting…" : "Mute today"}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                }

                const inner = (
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white leading-snug">{alert.detail.name}</div>
                      <div className="text-sm text-white leading-snug mt-0.5 flex items-center gap-1">
                        <span className="text-[1.15em]" aria-hidden>{STATUS_EMOJI[alert.severity]}</span>
                        {alert.detail.sub}
                      </div>
                    </div>
                    {alert.action_url && (
                      <span className="text-sm text-sky-100 shrink-0 self-center">Record ›</span>
                    )}
                  </>
                )
                return alert.action_url ? (
                  <Link key={i} href={alert.action_url}
                    className={`${rowClass} hover:bg-white/10 active:bg-white/15 transition-colors`}>
                    {inner}
                  </Link>
                ) : (
                  <div key={i} className={rowClass}>{inner}</div>
                )
              })
            )}
          </div>
          {hasAlerts && (
            <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-b from-transparent to-[#1A5F96] rounded-b-xl" />
          )}
        </div>
      </div>

      {entry?.hydration?.goal_ml != null && (
        <div className="shrink-0 mx-4 mt-2 mb-1">
          <Link href={`/${personId}/record-observation?type=Hydration`} className={`${cardClass} p-4 flex flex-col gap-2 hover:bg-fc-blue-dark active:bg-fc-blue-dark cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80`}>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-cyan-300 font-medium text-sm">
                <span aria-hidden>💧</span>
                Hydration
                {entry.hydration.hydrationMutedToday && (
                  <span className="text-white font-normal text-xs">Reminders muted today</span>
                )}
                {entry.hydration.status === "met" && (
                  <span className="text-green-300 font-normal">Goal met</span>
                )}
              </span>
              <span className="text-sm text-sky-100/70 tabular-nums">
                {formatHydration(entry.hydration.total_ml)} / {formatHydration(entry.hydration.goal_ml)}
              </span>
            </div>
            <div className="h-[7px] rounded-full bg-white/15 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${entry.hydration.status === "met" ? "bg-green-400" : "bg-cyan-400"}`}
                style={{ width: `${Math.min(entry.hydration.percent ?? 0, 100)}%` }}
              />
            </div>
            {(() => {
              const hint =
                entry.hydration.pacing && !entry.hydration.hydrationMutedToday
                  ? hydrationPacingHint(entry.hydration.pacing)
                  : null
              return hint ? (
                <p className="text-xs text-white leading-snug flex items-center gap-1">
                  <span aria-hidden>{STATUS_EMOJI.amber}</span>
                  {hint}
                </p>
              ) : null
            })()}
          </Link>
        </div>
      )}

      <main {...mainContentTargetProps} className="flex-1 bg-fc-blue overflow-y-auto fc-scroll p-4 min-h-0">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-w-4xl mx-auto">
          {cards.map(card => (
            <Link key={card.href} href={card.href} className={tileClass}>
              <span className="text-3xl" aria-hidden>
                {card.icon}
              </span>
              <div>
                <div className="text-white font-bold text-base leading-tight">{card.title}</div>
                <div className="text-white text-sm mt-1 leading-snug">{card.description}</div>
              </div>
            </Link>
          ))}
        </div>

        {!canWrite && (
          <p className="text-white text-sm text-center mt-6 max-w-xl mx-auto">
            Read-only access — contact your administrator to enable recording.
          </p>
        )}
      </main>
    </>
  )
}
