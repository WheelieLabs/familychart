// SPDX-License-Identifier: AGPL-3.0-only

/** The base32 secret from an otpauth URI, or null when the URI is malformed or has none. */
export function otpauthSecret(uri: string | null): string | null {
  if (!uri) return null
  try {
    return new URL(uri).searchParams.get("secret") || null
  } catch {
    return null
  }
}

/** Groups a secret in fours so it is easier to read and type into an authenticator app. */
export function formatSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, "$1 ")
}
