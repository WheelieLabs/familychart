// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Trimmed local blocklist: slurs + severe profanity only (~18 terms).
 *
 * Hybrid moderation: obvious/harmful terms reject instantly; mild profanity and
 * obfuscation are delegated to purgomalum (demo mode only). Word-boundary matching limits
 * false positives on clinical vocabulary.
 */
export const DEMO_PROFANITY_TERMS: readonly string[] = [
  "asshole",
  "bitch",
  "chink",
  "cock",
  "coon",
  "cunt",
  "fag",
  "faggot",
  "fuck",
  "fucker",
  "fucking",
  "kike",
  "nazi",
  "nigger",
  "pussy",
  "shit",
  "spic",
  "whore",
]

/** Purgomalum endpoint used when demo mode is armed (fail-open on error). */
export const PURGOMALUM_CONTAINS_URL =
  "https://www.purgomalum.com/service/containsprofanity"

/** Max wait for purgomalum before fail-open (ms). */
export const PURGOMALUM_TIMEOUT_MS = 1000
