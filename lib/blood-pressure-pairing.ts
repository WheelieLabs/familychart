// SPDX-License-Identifier: AGPL-3.0-only

/** Shared BP pairing for API summary and history UI — session groups with legacy single-field fallback. */

export interface BpObservationRow {
  id: number
  value: number
  unit: string
  recorded_at: string
  session_id: string | null
  value_label: string | null
  comments?: string | null
}

/**
 * "summary" pairs on sys+dia presence alone (best-effort latest-value display, e.g. a stray
 * extra session reading doesn't block it). "detail" additionally requires the session contain
 * only the labelled sys/dia rows — a stray extra reading falls the whole group back to singles.
 */
export type BpPairMode = "summary" | "detail"

export type BpGroupedRow<T extends BpObservationRow = BpObservationRow> =
  | {
      kind: "pair"
      session_id: string
      sys: T
      dia: T
      recorded_at: string
      comments: string | null
    }
  | { kind: "single"; record: T }

export function maxIso(a: string, b: string): string {
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b
}

export function formatBpSingle(r: BpObservationRow): string {
  const lab = r.value_label?.trim()
  if (lab) return `${lab}: ${r.value} ${r.unit}`
  return `${r.value} ${r.unit}`
}

function mergeDetailComments(sys: BpObservationRow, dia: BpObservationRow): string | null {
  const cmts = [sys.comments, dia.comments].filter(Boolean)
  return cmts.length ? cmts.join(" — ") : null
}

/** Pairs a single session's rows (sys/dia lookup + mode-specific gate); null if the group doesn't qualify. */
export function pairBpSessionMates<T extends BpObservationRow>(
  group: T[],
  mode: BpPairMode,
): { sys: T; dia: T; recorded_at: string; comments: string | null } | null {
  const sys = group.find(x => x.value_label === "Systolic")
  const dia = group.find(x => x.value_label === "Diastolic")
  if (!sys || !dia) return null
  if (mode === "detail") {
    const onlyLabelled = group.every(x => x.value_label === "Systolic" || x.value_label === "Diastolic")
    if (!onlyLabelled) return null
  }
  return {
    sys,
    dia,
    recorded_at: maxIso(sys.recorded_at, dia.recorded_at),
    comments: mode === "detail" ? mergeDetailComments(sys, dia) : null,
  }
}

/**
 * Groups BP rows by session, pairing systolic/diastolic per `mode`. Legacy unsessioned rows,
 * and any session that doesn't qualify for pairing, come back as individual "single" rows.
 * Result is sorted newest-first.
 */
export function groupBpRows<T extends BpObservationRow>(records: T[], mode: BpPairMode): BpGroupedRow<T>[] {
  const bySession = new Map<string, T[]>()
  const noSession: T[] = []

  for (const r of records) {
    if (r.session_id) {
      if (!bySession.has(r.session_id)) bySession.set(r.session_id, [])
      bySession.get(r.session_id)!.push(r)
    } else {
      noSession.push(r)
    }
  }

  const rows: BpGroupedRow<T>[] = []

  for (const [sid, group] of bySession) {
    const paired = pairBpSessionMates(group, mode)
    if (paired) {
      rows.push({ kind: "pair", session_id: sid, ...paired })
    } else {
      for (const x of [...group].sort(
        (a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()
      )) {
        rows.push({ kind: "single", record: x })
      }
    }
  }

  for (const r of noSession.sort(
    (a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()
  )) {
    rows.push({ kind: "single", record: r })
  }

  rows.sort((a, b) => {
    const ta = new Date(a.kind === "pair" ? a.recorded_at : a.record.recorded_at).getTime()
    const tb = new Date(b.kind === "pair" ? b.recorded_at : b.record.recorded_at).getTime()
    return tb - ta
  })

  return rows
}

/** Latest display from recent rows (newest-first); pairs by session_id when both halves are present. */
export function latestBpFromRecentRows(
  records: BpObservationRow[],
): { display: string; last_recorded: string; latest_unit: string } | null {
  if (records.length === 0) return null
  const sorted = [...records].sort(
    (a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime(),
  )
  const newest = sorted[0]!
  if (newest.session_id) {
    const mates = sorted.filter(r => r.session_id === newest.session_id)
    const paired = pairBpSessionMates(mates, "summary")
    if (paired) {
      return {
        display: `${paired.sys.value}/${paired.dia.value} mmHg`,
        last_recorded: paired.recorded_at,
        latest_unit: "",
      }
    }
  }
  return {
    display: formatBpSingle(newest),
    last_recorded: newest.recorded_at,
    latest_unit: newest.unit,
  }
}
