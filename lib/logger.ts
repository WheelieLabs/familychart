// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Structured JSON logs for container log ingestion.
 * Admin parses `{ level, msg }` from each line; plaintext framework lines are treated as info.
 */

import { writeSync } from "fs"

type LogContext = Record<string, unknown>

function normalizeCtx(ctx?: LogContext | unknown): LogContext | undefined {
  if (ctx === undefined || ctx === null) return undefined
  if (ctx instanceof Error) return { err: ctx.message }
  if (typeof ctx === "object" && !Array.isArray(ctx)) return ctx as LogContext
  return { detail: ctx }
}

function emit(level: string, msg: string, ctx?: LogContext | unknown): void {
  const extra = normalizeCtx(ctx)
  const line = JSON.stringify({ ts: Date.now(), level, msg, ...extra }) + "\n"
  // Sync write so Docker captures lines immediately (stdout is block-buffered when piped).
  writeSync(level === "error" ? 2 : 1, line)
}

/**
 * Security / admin audit mirror for the Admin container log stream.
 * Emits at info with `audit: true` so operators can filter; never pass secrets/OTPs/keys.
 */
function audit(msg: string, ctx?: LogContext | unknown): void {
  const extra = normalizeCtx(ctx)
  emit("info", msg, { audit: true, ...extra })
}

export const logger = {
  info: (msg: string, ctx?: LogContext | unknown) => emit("info", msg, ctx),
  warn: (msg: string, ctx?: LogContext | unknown) => emit("warn", msg, ctx),
  error: (msg: string, ctx?: LogContext | unknown) => emit("error", msg, ctx),
  audit,
}
