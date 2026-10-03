// SPDX-License-Identifier: AGPL-3.0-only

export const HYDRATION_OBSERVATION_TYPE = "Hydration"

/** Quick-pick amounts on the Hydration record page, in mL. */
export const HYDRATION_PRESETS = [
  { ml: 250, label: "Mug" },
  { ml: 375, label: "Can" },
  { ml: 400, label: "Glass" },
  { ml: 600, label: "Bottle" },
] as const

const MAX_FAVOURITE_AMOUNT_ML = 10_000

export function matchingHydrationPreset(
  value: string,
  unit: string,
): (typeof HYDRATION_PRESETS)[number] | null {
  if (unit !== "mL") return null
  return HYDRATION_PRESETS.find((p) => String(p.ml) === value.trim()) ?? null
}

/** A Hydration favourite's pre-set amount: a whole number of mL, 1–10000. */
export function parseHydrationFavouriteAmount(raw: string): number | null {
  const s = raw.trim()
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return n >= 1 && n <= MAX_FAVOURITE_AMOUNT_ML ? n : null
}

export type FavouriteDefaultValidation =
  | { ok: true; value: string | null }
  | { ok: false; error: string }

/**
 * Validates and normalises a favourite's `default_value`: free-text dose for medications, a
 * whole-mL amount for Hydration, and nothing for other observation types.
 */
export function validateFavouriteDefaultValue(
  actionKind: string,
  observationType: string | null,
  raw: unknown,
): FavouriteDefaultValidation {
  const trimmed = typeof raw === "string" ? raw.trim() : ""
  if (trimmed === "") return { ok: true, value: null }
  if (actionKind === "medication") return { ok: true, value: trimmed }
  if (observationType !== HYDRATION_OBSERVATION_TYPE) {
    return {
      ok: false,
      error: "default_value is only supported for Hydration observation favourites",
    }
  }
  const ml = parseHydrationFavouriteAmount(trimmed)
  if (ml == null) {
    return { ok: false, error: "Amount must be a whole number of mL between 1 and 10000" }
  }
  return { ok: true, value: String(ml) }
}

export function favouriteRecordHref(fav: {
  action_kind: string
  person_id: number
  medication_id: number | null
  observation_type: string | null
  default_value: string | null
}): string {
  if (fav.action_kind === "medication") {
    const params = new URLSearchParams({ medication_id: String(fav.medication_id) })
    if (fav.default_value) params.set("dosage", fav.default_value)
    return `/${fav.person_id}/record-medication?${params}`
  }
  const params = new URLSearchParams({ type: fav.observation_type! })
  if (fav.observation_type === HYDRATION_OBSERVATION_TYPE && fav.default_value) {
    params.set("amount", fav.default_value)
  }
  return `/${fav.person_id}/record-observation?${params}`
}
