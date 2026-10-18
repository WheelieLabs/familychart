// SPDX-License-Identifier: AGPL-3.0-only

import { randomInt } from "crypto"

/**
 * 32 characters with no 0/O and no 1/I, so a passphrase can be read back and typed.
 * The zip format's key derivation is fixed and weak, so the passphrase has to carry the strength.
 */
export const EXPORT_PASSPHRASE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

export const EXPORT_PASSPHRASE_LENGTH = 20

const ALPHABET = new Set(EXPORT_PASSPHRASE_ALPHABET)

/** Twenty characters from a cryptographically secure source. Not for display. */
export function generateExportPassphrase(): string {
  let passphrase = ""
  for (let i = 0; i < EXPORT_PASSPHRASE_LENGTH; i++) {
    passphrase += EXPORT_PASSPHRASE_ALPHABET[randomInt(EXPORT_PASSPHRASE_ALPHABET.length)]
  }
  return passphrase
}

/** Four groups of five, for showing and copying. The spaces are not part of the passphrase. */
export function formatExportPassphrase(passphrase: string): string {
  return passphrase.replace(/(.{5})(?=.)/g, "$1 ")
}

/** Drops spaces and hyphens and uppercases, so a grouped copy still opens the file. */
export function normaliseExportPassphrase(input: string): string {
  return input.replace(/[\s-]+/g, "").toUpperCase()
}

export function isExportPassphrase(input: string): boolean {
  return input.length === EXPORT_PASSPHRASE_LENGTH && [...input].every(char => ALPHABET.has(char))
}
