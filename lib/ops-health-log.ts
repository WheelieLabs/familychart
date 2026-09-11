// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Ops boot/heartbeat signal for Admin log-health.
 * Message must stay exactly "Healthy" for operator grep and Admin ingest.
 */

import { logger } from "@/lib/logger"

/** Refresh Admin rolling log-health window without spamming container_logs. */
export const HEALTHY_LOG_INTERVAL_MS = 5 * 60 * 1000

let lastEmittedAt = 0
let heartbeatStarted = false

function emitHealthy(force = false): void {
  const now = Date.now()
  if (!force && now - lastEmittedAt < HEALTHY_LOG_INTERVAL_MS) return
  lastEmittedAt = now
  logger.info("Healthy")
}

/** Once after successful boot — call from instrumentation only. */
export function emitHealthyBootSignal(): void {
  emitHealthy(true)
  if (heartbeatStarted) return
  heartbeatStarted = true
  setInterval(() => emitHealthy(false), HEALTHY_LOG_INTERVAL_MS)
}

/** Throttled emit from GET /api/health (Docker healthcheck every 30s). */
export function emitHealthyFromHealthcheck(): void {
  emitHealthy(false)
}
