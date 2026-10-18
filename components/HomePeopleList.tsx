// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import EmptyState, { EMPTY_STATE_ICONS } from "@/components/ui/EmptyState"
import type { Person } from "@/lib/domain-types"
import type { DashboardPersonStatus, DashboardStatus } from "@/lib/dashboard/dashboard-status"
import { dashboardScheduleHeaders } from "@/lib/dashboard/dashboard-client-context"

type HomePerson = Person & { canWrite: boolean }

const STATUS_EMOJI: Record<DashboardStatus, string> = {
  red: "🔴",
  amber: "🟡",
  // Like the other dots, colour is never the only signal: the alert text always sits beside it.
  notice: "🔵",
  green: "🟢",
}

export default function HomePeopleList({ people }: { people: HomePerson[] }) {
  const [dashboard, setDashboard] = useState<DashboardPersonStatus[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    function load() {
      fetch("/api/dashboard", { cache: "no-store", headers: dashboardScheduleHeaders() })
        .then(r => {
          if (!r.ok) throw new Error("dashboard fetch failed")
          return r.json() as Promise<DashboardPersonStatus[]>
        })
        .then(data => {
          if (!cancelled) {
            setDashboard(data)
            setFailed(false)
          }
        })
        .catch(() => {
          if (!cancelled) setFailed(true)
        })
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

  const byPersonId = useMemo(() => {
    const m = new Map<number, DashboardPersonStatus>()
    if (!dashboard) return m
    for (const row of dashboard) m.set(row.personId, row)
    return m
  }, [dashboard])

  if (people.length === 0) {
    return (
      <EmptyState icon={EMPTY_STATE_ICONS.noPeople} heading="No family members yet">
        Use the menu to open Management and add people.
      </EmptyState>
    )
  }

  return (
    <ul>
      {people.map(p => (
        <PersonHomeRow key={p.id} person={p} entry={failed ? undefined : byPersonId.get(p.id)} loading={!failed && dashboard === null} />
      ))}
    </ul>
  )
}

function PersonHomeRow({
  person,
  entry,
  loading,
}: {
  person: HomePerson
  entry?: DashboardPersonStatus
  loading: boolean
}) {
  const initials = person.name
    .split(" ")
    .map(w => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  const router = useRouter()

  return (
    <li
      className="border-b border-fc-blue-mid hover:bg-fc-blue-mid active:bg-fc-blue-dark transition-colors cursor-pointer"
      onClick={() => router.push(`/${person.id}`)}
    >
      <div className="flex items-center gap-4 px-4 py-3">
        <Link
          href={`/${person.id}`}
          className="shrink-0 outline-none rounded-full"
          aria-hidden="true"
          tabIndex={-1}
        >
          <div
            className="w-[5.5rem] h-[5.5rem] sm:w-24 sm:h-24 rounded-full border-[3px] border-fc-ring flex items-center justify-center overflow-hidden"
            style={{ backgroundColor: person.color }}
          >
            {person.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={person.photo_url} alt="" className="w-full h-full object-cover min-h-full min-w-full" />
            ) : (
              <span className="text-white font-bold text-3xl sm:text-4xl">{initials}</span>
            )}
          </div>
        </Link>
        <div className="flex flex-col gap-1 min-w-0">
          <Link href={`/${person.id}`} className="text-2xl font-bold text-white shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            {person.name}
          </Link>
          {loading ? (
            <span className="text-sm text-white">Status updating…</span>
          ) : entry ? (
            <div className="flex flex-col gap-0.5">
              {entry.alerts.length === 0 ? (
                <span className="text-sm text-white">
                  <span className="text-[1.15em]" aria-hidden>🟢</span>{" "}All clear
                </span>
              ) : (
                <>
                  {entry.alerts.slice(0, 2).map(alert => (
                    <span key={alert.short} className="text-sm text-white leading-snug">
                      <span className="text-[1.15em]" aria-hidden>{STATUS_EMOJI[alert.severity]}</span>{" "}
                      {alert.short}
                    </span>
                  ))}
                  {entry.alerts.length > 2 && (
                    <span className="text-xs text-white">+{entry.alerts.length - 2} more</span>
                  )}
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  )
}
