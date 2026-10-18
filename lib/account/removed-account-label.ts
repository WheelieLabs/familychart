// SPDX-License-Identifier: AGPL-3.0-only

import { randomBytes } from "node:crypto"

/** Prefix that is not an email address. The rest of the token is random and is stored only in the rows it replaces. */
export const REMOVED_ACCOUNT_PREFIX = "removed:"

export const REMOVED_ACCOUNT_LABEL = "Removed account"

export function newRemovedAccountToken(): string {
  return REMOVED_ACCOUNT_PREFIX + randomBytes(32).toString("base64url")
}

export function isRemovedAccountToken(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(REMOVED_ACCOUNT_PREFIX)
}

/** History, audit and other screens show this label. The stored token is never shown. */
export function displayAccountActor(value: string | null | undefined, empty = "system"): string {
  if (!value) return empty
  if (isRemovedAccountToken(value)) return REMOVED_ACCOUNT_LABEL
  return value
}
