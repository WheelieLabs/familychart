// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import SaveFlash from "@/components/SaveFlash"
import DoseExpectationActions from "@/components/DoseExpectationActions"
import MedicationTimeline from "@/components/MedicationTimeline"
import StatusRegion from "@/components/StatusRegion"
import Button from "@/components/ui/Button"
import { HubButtonTile, HubGrid, HubTile } from "@/components/ui/HubTile"
import PageContainer from "@/components/ui/PageContainer"
import Surface from "@/components/ui/Surface"
import type { DashboardPersonStatus, DashboardSeverity, DashboardStatus } from "@/lib/dashboard/dashboard-status"
import { dashboardScheduleHeaders } from "@/lib/dashboard/dashboard-client-context"
import { formatSlotHhmm } from "@/lib/medication/dose-timing-display"
import { formatHydration } from "@/lib/format"
import { hydrationPacingHint } from "@/lib/hydration/hydration-pacing-copy"
import { personHubTrail } from "@/lib/ui/breadcrumbs"
import { partitionActionTiles } from "@/lib/person/action-screen"

const STATUS_EMOJI: Record<DashboardStatus, string> = {
  red: "🔴",
  amber: "🟡",
  // Like the other dots, colour is never the only signal: the alert text always sits beside it.
  notice: "🔵",
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
  /** Live Feed row id (e.g. `med:12`) to emphasise on the medication timeline. */
  highlightTimelineRowId?: string | null
}

type ActionCard = { href: string; icon: string; title: string }

export default function PersonPageActions({ personId, name, photoUrl, color = "#256AA5", canWrite, isLinkedViewer, highlightTimelineRowId = null }: Props) {
  const [dashboard, setDashboard] = useState<DashboardPersonStatus[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [muting, setMuting] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)

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
        },
        {
          href: `/${personId}/record-observation`,
          icon: "📊",
          title: "Record Observation",
        },
        {
          href: `/${personId}/record-test-result`,
          icon: "🧪",
          title: "Record Test Result",
        },
        {
          href: `/${personId}/record-symptom`,
          icon: "🤒",
          title: "Record Symptom",
        }
      )
    }
    out.push({
      href: `/${personId}/history`,
      icon: "📜",
      title: "History",
    })
    out.push({
      href: `/${personId}/test-chart`,
      icon: "📈",
      title: "Test Result Chart",
    })
    if (canWrite) {
      out.push({
        href: `/${personId}/schedules-goals`,
        icon: "🗓️",
        title: "Schedules & Goals",
      })
    }
    return out
  }, [personId, canWrite])

  // Tiles are ordered most to least frequent; past the cap the rest sit behind "More".
  const { visible: visibleCards, more: moreCards } = partitionActionTiles(cards)

  const initials = name
    .split(" ")
    .map(w => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  const hasAlerts = (entry?.alerts ?? []).length > 0
  // Worst-of-all-rows accent is intentional: a single red row should draw
  // attention to the whole card, not just its own row.
  const maxSeverity: DashboardSeverity =
    entry?.alerts.some(a => a.severity === "red") ? "red"
    : entry?.alerts.some(a => a.severity === "amber") ? "amber"
    : "notice"

  const timelineHasContent = Boolean(entry?.medicationTimeline && entry.medicationTimeline.length > 0)

  /** One alert row's text: the name and the status dot with its words (the dot never stands alone). */
  const alertText = (alert: NonNullable<typeof entry>["alerts"][number]) => (
    <div className="fc-alert-row__text">
      <div className="fc-alert-row__name">{alert.detail.name}</div>
      <div className="fc-alert-row__sub">
        <span className="fc-dot" aria-hidden>{STATUS_EMOJI[alert.severity]}</span>
        {alert.detail.sub}
      </div>
    </div>
  )

  // Missed doses are quiet information, not alerts: the blue notice dot, not counted, and gone when the day ends.
  const missedLines = (entry?.missedSlots ?? []).map(slot => (
    <div key={`missed-${slot.id}`} className="fc-alert-row">
      <div className="fc-alert-row__text">
        <div className="fc-alert-row__name">{slot.medicationName}</div>
        <div className="fc-alert-row__sub">
          <span className="fc-dot" aria-hidden>{STATUS_EMOJI.notice}</span>
          {slot.day === "yesterday" ? "Yesterday's" : "Today's"} {formatSlotHhmm(slot.slotHhmm)} dose was missed.
        </div>
      </div>
    </div>
  ))

  // Both status panels share one fixed height, so the grid below never shifts between states.
  const alertsSlide = (
    <Surface kind="dark" className="fc-status-card" data-accent={hasAlerts ? maxSeverity : undefined}>
      <div className="fc-status-scroll" role="region" aria-label="Alerts" tabIndex={0}>
        {!hasAlerts ? (
          <>
            {missedLines}
            <div className={`fc-status-empty${missedLines.length > 0 ? " fc-status-empty--compact" : ""}`}>
              <span>✓ No alerts — nothing due right now</span>
            </div>
          </>
        ) : (
          (entry?.alerts ?? []).map(alert => {
            const key = `${alert.detail.name}-${alert.detail.sub}`
            const isHydrationAlert = alert.detail.name === "Hydration" && alert.action_url != null

            if (isHydrationAlert) {
              return (
                <div key={key} className="fc-alert-row">
                  {alertText(alert)}
                  <div className="fc-alert-row__actions">
                    {isLinkedViewer && (
                      <Button
                        variant="secondary"
                        onClick={() => void muteHydrationToday()}
                        pending={muting}
                        pendingLabel="Muting…"
                      >
                        Mute today
                      </Button>
                    )}
                    <Button variant="secondary" href={alert.action_url!}>Record</Button>
                  </div>
                </div>
              )
            }

            if (alert.resolveSymptom) {
              return (
                <div key={key} className="fc-alert-row">
                  {alertText(alert)}
                  {canWrite && (
                    // Saving the symptom while it is still open counts as today's "still ongoing" answer.
                    <div className="fc-alert-row__actions">
                      <Button variant="secondary" href={`/${personId}/record-symptom?edit=${alert.resolveSymptom.symptomId}`}>
                        Update
                      </Button>
                    </div>
                  )}
                </div>
              )
            }

            if (alert.resolve) {
              return (
                <div key={key} className="fc-alert-row">
                  {alertText(alert)}
                  {canWrite && (
                    <DoseExpectationActions
                      expectationId={alert.resolve.expectationId}
                      ymd={alert.resolve.ymd}
                      onResolved={() => void loadDashboard()}
                    />
                  )}
                </div>
              )
            }

            return alert.action_url ? (
              <div key={key} className="fc-alert-row">
                {alertText(alert)}
                <div className="fc-alert-row__actions">
                  <Button variant="secondary" href={alert.action_url} aria-label={`Record ${alert.detail.name}`}>Record</Button>
                </div>
              </div>
            ) : (
              <div key={key} className="fc-alert-row">{alertText(alert)}</div>
            )
          })
        )}
        {hasAlerts && missedLines}
      </div>
      {hasAlerts && <div className="fc-status-fade" />}
    </Surface>
  )

  const hydration = entry?.hydration

  return (
    <PageContainer
      trail={personHubTrail(name)}
      header={
        <div className="fc-person-head">
          <div className="fc-person-head__avatar" style={{ backgroundColor: color }}>
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt="" />
            ) : (
              <span aria-hidden>{initials}</span>
            )}
          </div>
          <div className="fc-person-head__body">
            <h2 className="fc-person-head__name">{name}</h2>
            {!failed && dashboard === null ? (
              <span>Status updating…</span>
            ) : failed ? (
              <span>Dashboard status could not be loaded.</span>
            ) : entry ? (
              // Same structure with and without alerts, so the line is the same height and the grid never moves.
              <span className="fc-person-head__status">
                <span className="fc-dot" aria-hidden>
                  {STATUS_EMOJI[entry.alerts.length > 0 ? maxSeverity : entry.status]}
                </span>
                <span title={entry.summary}>{entry.summary}</span>
              </span>
            ) : null}
          </div>
        </div>
      }
    >
      <SaveFlash />

      <StatusRegion
        hasAlerts={hasAlerts}
        hasNotices={missedLines.length > 0}
        alertSeverity={maxSeverity}
        alertCount={(entry?.alerts ?? []).length}
        timelineParam={highlightTimelineRowId}
        alertsSlide={alertsSlide}
        timelineHasContent={timelineHasContent}
        ready={dashboard !== null || failed}
        timelineSlide={
          <MedicationTimeline
            personId={personId}
            lanes={entry?.medicationTimeline ?? []}
            highlightFeedRowId={highlightTimelineRowId}
            loading={dashboard === null && !failed}
            embedded
          />
        }
      />

      {hydration?.goal_ml != null && (
        <Surface as={Link} kind="dark" href={`/${personId}/record-observation?type=Hydration`} className="fc-hydration">
          <div className="fc-hydration__row">
            <span className="fc-hydration__name">
              <span aria-hidden>💧</span>
              Hydration
              {hydration.hydrationMutedToday && (
                <span className="fc-hydration__note">Reminders muted today</span>
              )}
              {hydration.status === "met" && (
                <span className="fc-hydration__met">Goal met</span>
              )}
            </span>
            <span className="fc-hydration__amount">
              {formatHydration(hydration.total_ml)} / {formatHydration(hydration.goal_ml)}
            </span>
          </div>
          <div className="fc-hydration__bar" aria-hidden>
            <div
              className={`fc-hydration__fill${hydration.status === "met" ? " fc-hydration__fill--met" : ""}`}
              style={{ width: `${Math.min(hydration.percent ?? 0, 100)}%` }}
            />
          </div>
          {/* One line is always reserved for the pacing hint, so the card keeps the same height with or without it. */}
          {(() => {
            const hint =
              hydration.pacing && !hydration.hydrationMutedToday
                ? hydrationPacingHint(hydration.pacing)
                : null
            return (
              <p className="fc-hydration__hint">
                {hint && (
                  <>
                    <span aria-hidden>{STATUS_EMOJI.amber}</span>
                    {hint}
                  </>
                )}
              </p>
            )
          })()}
        </Surface>
      )}

      <HubGrid dense>
        {visibleCards.map(card => (
          <HubTile key={card.href} href={card.href} icon={card.icon} title={card.title} />
        ))}
        {moreCards.length > 0 && (
          <HubButtonTile icon="⋯" title="More" expanded={moreOpen} controls="more-actions" onClick={() => setMoreOpen(o => !o)} />
        )}
      </HubGrid>
      {moreCards.length > 0 && moreOpen && (
        <div id="more-actions">
          <HubGrid dense>
            {moreCards.map(card => (
              <HubTile key={card.href} href={card.href} icon={card.icon} title={card.title} />
            ))}
          </HubGrid>
        </div>
      )}

      {!canWrite && (
        <p className="fc-admin-note">Read-only access — contact your administrator to enable recording.</p>
      )}
    </PageContainer>
  )
}
