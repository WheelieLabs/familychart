// SPDX-License-Identifier: AGPL-3.0-only

const DEFAULT_MAX_UPLOAD_MB = 512

/** Largest restore upload in bytes (`FC_RESTORE_MAX_UPLOAD_MB`, default 512). */
export function restoreMaxUploadBytes(): number {
  const raw = process.env.FC_RESTORE_MAX_UPLOAD_MB
  if (raw == null || raw.trim() === "") return DEFAULT_MAX_UPLOAD_MB * 1024 * 1024
  const mb = Number(raw)
  if (!Number.isFinite(mb) || mb <= 0) return DEFAULT_MAX_UPLOAD_MB * 1024 * 1024
  return Math.floor(mb * 1024 * 1024)
}
