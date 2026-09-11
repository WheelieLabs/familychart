// SPDX-License-Identifier: AGPL-3.0-only

import { acquireDbKey, getDbKey } from "./db-key"
import type { EncryptionMode } from "./mode"

export type KeyConfigSource = "none" | "env" | "keyserver" | "inline"

export interface KeyConfig {
  /** Cipher boundary: none = plaintext SQLite, env/keyserver = SQLCipher. */
  mode: EncryptionMode
  /** How to resolve the passphrase (inline for CLI one-shot). */
  source: KeyConfigSource
  /** Hex passphrase when source is inline. */
  inlinePassphrase?: string
}

export function keyConfigFromEnv(overrides?: Partial<Record<string, string>>): KeyConfig {
  const env = { ...process.env, ...overrides }
  const mode = (env.FC_ENCRYPTION_MODE?.trim().toLowerCase() || "none") as EncryptionMode
  if (mode === "none") return { mode: "none", source: "none" }
  if (mode === "env") return { mode: "env", source: "env" }
  return { mode: "keyserver", source: "keyserver" }
}

/**
 * Resolve passphrase for a key config. Hard-halts on failure — never returns partial state.
 */
export async function resolveKeyConfigPassphrase(config: KeyConfig): Promise<string | null> {
  if (config.mode === "none") return null

  if (config.source === "inline") {
    const p = config.inlinePassphrase?.trim()
    if (!p) throw new Error("inline key config requires inlinePassphrase")
    return p
  }

  if (config.source === "env") {
    const key = process.env.FC_DB_KEY?.trim() || process.env.DB_ENCRYPTION_KEY?.trim()
    if (!key) throw new Error("env key config requires FC_DB_KEY")
    return key
  }

  if (config.source === "keyserver") {
    await acquireDbKey()
    return getDbKey()
  }

  throw new Error(`Cannot resolve passphrase for source: ${config.source}`)
}

export function crossesCipherBoundary(from: KeyConfig, to: KeyConfig): boolean {
  const fromEncrypted = from.mode !== "none"
  const toEncrypted = to.mode !== "none"
  return fromEncrypted !== toEncrypted
}
