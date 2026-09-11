// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { logger } from "./logger"

/** Entity types whose audit_log rows also mirror to stdout for Admin log stream. */
const STREAM_AUDIT_ENTITY_TYPES = new Set([
  "accounts",
  "system_config",
  "app_settings",
  "uploads",
])

export function auditLog(
  db: Database.Database,
  userEmail: string | null | undefined,
  action: string,
  entityType: string,
  entityId: number | null,
  details?: object
) {
  db.prepare(
    `INSERT INTO audit_log (user_email, action, entity_type, entity_id, details)
     VALUES (?, ?, ?, ?, ?)`
  ).run(userEmail ?? null, action, entityType, entityId,
        details ? JSON.stringify(details) : null)

  if (STREAM_AUDIT_ENTITY_TYPES.has(entityType)) {
    // Mirror security/admin mutations to container logs — never include secret values.
    // app_settings secret audits already store `{ key, changed: true }` only.
    logger.audit("audit_log", {
      actor: userEmail ?? null,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details: details ?? null,
    })
  }
}
