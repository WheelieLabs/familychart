// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { resolveSetting } from "@/lib/settings/resolver"
import { SETTING_SECURITY_PASSWORD_MIN_LENGTH } from "@/lib/settings/registry"

/**
 * Validates a new-password + confirm-password pair against the instance's configured
 * minimum length. Returns an error message to surface to the caller, or `null` if valid.
 */
export function validateNewPassword(
  db: Database.Database,
  password: string,
  confirmPassword: string,
  mismatchMessage = "Passwords do not match",
): string | null {
  const minLen = parseInt(resolveSetting(db, SETTING_SECURITY_PASSWORD_MIN_LENGTH).value, 10)
  if (password.length < minLen) return `Password must be at least ${minLen} characters`
  if (password !== confirmPassword) return mismatchMessage
  return null
}
