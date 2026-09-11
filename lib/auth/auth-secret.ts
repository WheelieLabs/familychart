// SPDX-License-Identifier: AGPL-3.0-only

/** Known placeholder values that must not be used as NEXTAUTH_SECRET in production. */
export const WEAK_NEXTAUTH_SECRETS = new Set([
  "change-me",
  "your-secret-here",
  "changeme",
  "secret",
  "test",
])

const MIN_SECRET_LENGTH = 32

/**
 * Fail closed in production when NEXTAUTH_SECRET is missing, weak, or too short.
 * Dev/test environments are not checked (local convenience).
 */
export function validateNextAuthSecretAtBoot(): void {
  if (process.env.NODE_ENV !== "production") return

  const secret = process.env.NEXTAUTH_SECRET?.trim()
  if (!secret) {
    throw new Error(
      "NEXTAUTH_SECRET is required in production. Generate one with: openssl rand -base64 32",
    )
  }
  if (WEAK_NEXTAUTH_SECRETS.has(secret.toLowerCase())) {
    throw new Error(
      "NEXTAUTH_SECRET is a known placeholder value — replace it before running in production",
    )
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `NEXTAUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production`,
    )
  }
}
