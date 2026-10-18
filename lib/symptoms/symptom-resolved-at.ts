// SPDX-License-Identifier: AGPL-3.0-only

/** Server-derived resolved_at: set on the transition into resolved, kept as-is while already resolved, cleared otherwise. */
export function nextResolvedAt(isResolved: boolean, wasResolved: boolean, existingResolvedAt: string | null): string | null {
  if (!isResolved) return null
  return wasResolved ? existingResolvedAt : new Date().toISOString()
}
