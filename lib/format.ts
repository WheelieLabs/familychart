// SPDX-License-Identifier: AGPL-3.0-only

export function formatHydration(ml: number): string {
  if (ml < 1000) return `${Math.round(ml)}mL`
  return `${(ml / 1000).toFixed(1)}L`
}
