// SPDX-License-Identifier: AGPL-3.0-only

import type { NextRequest } from "next/server"
import type Database from "better-sqlite3-multiple-ciphers"
import { tzLocalYmdAndOffset, localDateToIsoYmd } from "@/lib/datetime"
import { resolveEffectiveIanaTz } from "@/lib/instance-timezone"

export interface CalendarContext {
  ymd: string
  offsetMinutes: number
  ianaTz: string | null
}

const ISO_YMD = /^\d{4}-\d{2}-\d{2}$/

/**
 * Resolve the local calendar context for schedule evaluation.
 *
 * Precedence: rowTz → instance IANA → client offset headers
 *
 * Returns null only on the cron path (no request) when no IANA timezone is
 * configured — hard gate matching cron's pre-requisite for a valid IANA zone.
 */
export function resolveCalendarContext(
  db: Database.Database,
  rowTz: string | null | undefined,
  nowMs: number,
  request?: NextRequest,
): CalendarContext | null {
  const ianaTz = resolveEffectiveIanaTz(rowTz, db)

  if (ianaTz) {
    const { ymd, offsetMinutes } = tzLocalYmdAndOffset(nowMs, ianaTz)
    return { ymd, offsetMinutes, ianaTz }
  }

  if (!request) {
    return null
  }

  const todayH = request.headers.get("x-fc-local-today")?.trim()
  const ymd =
    todayH != null && ISO_YMD.test(todayH) ? todayH : localDateToIsoYmd(new Date(nowMs))

  const offRaw = request.headers.get("x-fc-tz-offset")
  const offsetMinutes =
    offRaw != null && offRaw.trim() !== "" && Number.isFinite(Number.parseInt(offRaw, 10))
      ? Number.parseInt(offRaw, 10)
      : new Date().getTimezoneOffset()

  return { ymd, offsetMinutes, ianaTz: null }
}

/** Parse the client clock from `x-fc-client-now`, falling back to `Date.now()`. */
export function parseClientNow(request: NextRequest): Date {
  const raw = request.headers.get("x-fc-client-now")
  if (raw != null) {
    const t = Date.parse(raw)
    if (Number.isFinite(t)) return new Date(t)
  }
  return new Date()
}

/**
 * Server-authoritative local calendar day for the effective IANA zone (row → instance),
 * or the process-local civil date when no IANA is configured.
 *
 * Never reads client day/clock headers — used to gate writes that must only apply to
 * "today" (e.g. `suppressNextSlot`) so forged `x-fc-client-now` / `x-fc-local-today`
 * cannot plant future-day suppressions.
 */
export function serverAuthoritativeLocalYmd(
  db: Database.Database,
  rowTz: string | null | undefined,
  nowMs: number,
): string {
  const ianaTz = resolveEffectiveIanaTz(rowTz, db)
  if (ianaTz) {
    return tzLocalYmdAndOffset(nowMs, ianaTz).ymd
  }
  return localDateToIsoYmd(new Date(nowMs))
}
