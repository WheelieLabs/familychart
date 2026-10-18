// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { findObservationTypeConfig } from "@/lib/observation/observation-type-meta"

export interface ObservationWriteInput {
  observation_type: string
  value: unknown
}

export function validateObservationWrite(
  db: Database.Database,
  input: ObservationWriteInput,
  options?: { requireActive?: boolean },
): { ok: true; observationType: string; value: number } | { ok: false; error: string } {
  const observationType =
    typeof input.observation_type === "string" ? input.observation_type.trim() : ""
  if (!observationType) {
    return { ok: false, error: "observation_type is required" }
  }

  const config = findObservationTypeConfig(db, observationType)
  // Restore writes history for a type the household has switched off, so activity is optional.
  // A type that is not in the catalogue at all stays an error either way.
  if (!config) {
    return {
      ok: false,
      error: options?.requireActive === false ? "Unknown observation type" : "Unknown or inactive observation type",
    }
  }
  if (!config.is_active && options?.requireActive !== false) {
    return { ok: false, error: "Unknown or inactive observation type" }
  }

  const numeric =
    typeof input.value === "number"
      ? input.value
      : typeof input.value === "string"
        ? Number(input.value)
        : NaN

  if (!Number.isFinite(numeric)) {
    return { ok: false, error: "value must be a finite number" }
  }
  if (numeric < 0) {
    return { ok: false, error: "value must be non-negative" }
  }
  if (Math.abs(numeric) > 1_000_000) {
    return { ok: false, error: "value is out of range" }
  }

  return { ok: true, observationType: config.observation_type, value: numeric }
}
