// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "@/lib/logger"
import { encryptionActive, getEncryptionMode, type EncryptionMode } from "./mode"
import { unwrapKeyFromKeyserver } from "./keyserver-unwrap"

const DB_KEY_SYMBOL = Symbol.for("familychart.dbKey")

type GlobalWithDbKey = typeof globalThis & { [key: symbol]: string | undefined }

function globalStore(): GlobalWithDbKey {
  return globalThis as GlobalWithDbKey
}

function storeDbKey(passphrase: string): void {
  globalStore()[DB_KEY_SYMBOL] = passphrase
}

function clearDbKey(): void {
  delete globalStore()[DB_KEY_SYMBOL]
}

/** Synchronous accessor — throws if key not acquired. Never log the return value. */
export function getDbKey(): string {
  const key = globalStore()[DB_KEY_SYMBOL]
  if (!key) {
    throw new Error("Database encryption key not acquired — boot halted")
  }
  return key
}

/** Returns true when a key is present (any encryption-active mode after acquire). */
export function hasDbKey(): boolean {
  return Boolean(globalStore()[DB_KEY_SYMBOL])
}

async function unwrapDbKeyFromKeyserver(): Promise<string> {
  const wrappedKey = process.env.DB_WRAPPED_KEY?.trim()
  if (!wrappedKey) {
    throw new Error("keyserver mode requires DB_WRAPPED_KEY")
  }
  return unwrapKeyFromKeyserver({ wrappedKey, label: "db" })
}

function resolveEnvKey(): string {
  const key = process.env.FC_DB_KEY?.trim() || process.env.DB_ENCRYPTION_KEY?.trim()
  if (!key) {
    throw new Error("env encryption mode requires FC_DB_KEY (or legacy DB_ENCRYPTION_KEY)")
  }
  return key
}

async function acquireForMode(mode: EncryptionMode): Promise<void> {
  switch (mode) {
    case "none":
      clearDbKey()
      return
    case "env":
      storeDbKey(resolveEnvKey())
      return
    case "keyserver":
      storeDbKey(await unwrapDbKeyFromKeyserver())
      return
  }
}

/**
 * Acquire the database passphrase at Node boot. Fail-closed on any error in
 * encryption-active modes.
 */
export async function acquireDbKey(): Promise<void> {
  const mode = getEncryptionMode()
  if (!encryptionActive(mode)) {
    clearDbKey()
    logger.info("db_key_acquired", { mode: "none" })
    return
  }
  await acquireForMode(mode)
  // Never log the passphrase — mode only.
  logger.info("db_key_acquired", { mode })
}

/** Probe keyserver reachability without storing a key (for health checks). */
export async function probeKeyserverHealth(): Promise<{ ok: boolean; error?: string }> {
  const url = process.env.DB_KEY_SERVER_URL?.trim()
  if (!url) return { ok: false, error: "DB_KEY_SERVER_URL not set" }
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
