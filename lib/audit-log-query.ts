// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"

export interface AuditLogRow {
  id: number
  user_email: string | null
  action: string
  entity_type: string
  entity_id: number | null
  details: string | null
  created_at: string
}

export interface AuditLogQuery {
  actor?: string
  action?: string
  entityType?: string
  from?: string
  to?: string
  limit: number
  offset: number
}

export interface AuditLogPage {
  rows: AuditLogRow[]
  total: number
  limit: number
  offset: number
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

export function parseAuditLogQuery(params: URLSearchParams): AuditLogQuery | { error: string } {
  const limitRaw = params.get("limit")
  const offsetRaw = params.get("offset")
  let limit = DEFAULT_LIMIT
  if (limitRaw != null && limitRaw !== "") {
    limit = parseInt(limitRaw, 10)
    if (!Number.isFinite(limit) || limit < 1 || limit > MAX_LIMIT) {
      return { error: "Invalid limit" }
    }
  }
  let offset = 0
  if (offsetRaw != null && offsetRaw !== "") {
    offset = parseInt(offsetRaw, 10)
    if (!Number.isFinite(offset) || offset < 0) {
      return { error: "Invalid offset" }
    }
  }

  const actor = params.get("actor")?.trim() || undefined
  const action = params.get("action")?.trim() || undefined
  const entityType = params.get("entity")?.trim() || params.get("entityType")?.trim() || undefined
  const from = params.get("from")?.trim() || undefined
  const to = params.get("to")?.trim() || undefined

  if (from && Number.isNaN(Date.parse(from))) return { error: "Invalid from date" }
  if (to && Number.isNaN(Date.parse(to))) return { error: "Invalid to date" }

  return { actor, action, entityType, from, to, limit, offset }
}

export function queryAuditLog(db: Database.Database, q: AuditLogQuery): AuditLogPage {
  const where: string[] = []
  const values: unknown[] = []

  if (q.actor) {
    where.push("user_email LIKE ?")
    values.push(`%${q.actor}%`)
  }
  if (q.action) {
    where.push("action = ?")
    values.push(q.action)
  }
  if (q.entityType) {
    where.push("entity_type = ?")
    values.push(q.entityType)
  }
  if (q.from) {
    where.push("created_at >= ?")
    values.push(q.from.includes("T") ? q.from : `${q.from}T00:00:00`)
  }
  if (q.to) {
    where.push("created_at <= ?")
    values.push(q.to.includes("T") ? q.to : `${q.to}T23:59:59`)
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM audit_log ${whereSql}`).get(...values) as { n: number }
  ).n

  const rows = db
    .prepare(
      `SELECT id, user_email, action, entity_type, entity_id, details, created_at
       FROM audit_log
       ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...values, q.limit, q.offset) as AuditLogRow[]

  return { rows, total, limit: q.limit, offset: q.offset }
}

export function listAuditLogFacets(db: Database.Database): {
  actions: string[]
  entityTypes: string[]
} {
  const actions = (
    db.prepare("SELECT DISTINCT action FROM audit_log ORDER BY action").all() as { action: string }[]
  ).map(r => r.action)
  const entityTypes = (
    db
      .prepare("SELECT DISTINCT entity_type FROM audit_log ORDER BY entity_type")
      .all() as { entity_type: string }[]
  ).map(r => r.entity_type)
  return { actions, entityTypes }
}
