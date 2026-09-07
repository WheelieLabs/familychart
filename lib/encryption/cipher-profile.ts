// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"

/**
 * Pinned SQLCipher compatibility profile. Changing this constant requires
 * rekeying every encrypted database.
 */
export const SQLCIPHER_PROFILE = {
  cipher: "sqlcipher",
  legacy: 4,
} as const

export function applyCipherProfile(db: Database.Database, passphrase: string): void {
  db.pragma(`cipher = ${SQLCIPHER_PROFILE.cipher}`)
  db.pragma(`legacy = ${SQLCIPHER_PROFILE.legacy}`)
  db.pragma(`key = "${escapePassphrase(passphrase)}"`)
}

/** Escape double quotes in passphrase for PRAGMA key string literals. */
function escapePassphrase(passphrase: string): string {
  return passphrase.replace(/"/g, '""')
}
