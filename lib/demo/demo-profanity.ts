// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "@/lib/logger"

import {
  DEMO_PROFANITY_TERMS,
  PURGOMALUM_CONTAINS_URL,
  PURGOMALUM_TIMEOUT_MS,
} from "@/lib/demo/profanity-terms"

const TERM_PATTERNS = DEMO_PROFANITY_TERMS.map(term => {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`\\b${escaped}\\b`, "i")
})

/** Returns true when text matches the local blocklist (word-boundary match). */
export function textContainsLocalProfanity(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return TERM_PATTERNS.some(re => re.test(trimmed))
}

/** Returns true when any non-empty field matches the local blocklist. */
export function fieldsContainLocalProfanity(
  fields: readonly (string | null | undefined)[],
): boolean {
  for (const field of fields) {
    if (field != null && field !== "" && textContainsLocalProfanity(String(field))) {
      return true
    }
  }
  return false
}

function batchFieldsForApi(fields: readonly (string | null | undefined)[]): string {
  return fields
    .filter(f => f != null && String(f).trim() !== "")
    .map(f => String(f))
    .join("\n")
}

/**
 * Purgomalum containsprofanity check — one batched request per write.
 * Fail-open (returns false) on timeout or network error.
 */
export async function fieldsContainProfanityViaApi(
  fields: readonly (string | null | undefined)[],
): Promise<boolean> {
  const combined = batchFieldsForApi(fields)
  if (!combined) return false

  try {
    const url = `${PURGOMALUM_CONTAINS_URL}?text=${encodeURIComponent(combined)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(PURGOMALUM_TIMEOUT_MS) })
    if (!res.ok) {
      logger.warn("[demo-profanity] purgomalum unavailable, fail-open")
      return false
    }
    const body = (await res.text()).trim().toLowerCase()
    return body === "true"
  } catch {
    logger.warn("[demo-profanity] purgomalum unavailable, fail-open")
    return false
  }
}

/** Local blocklist first, then purgomalum when demo mode calls this path. */
export async function fieldsContainProfanity(
  fields: readonly (string | null | undefined)[],
): Promise<boolean> {
  if (fieldsContainLocalProfanity(fields)) return true
  return fieldsContainProfanityViaApi(fields)
}
