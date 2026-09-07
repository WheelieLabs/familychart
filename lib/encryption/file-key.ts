// SPDX-License-Identifier: AGPL-3.0-only

import { encryptionActive, getEncryptionMode, type EncryptionMode } from "./mode"
import { unwrapKeyFromKeyserver } from "./keyserver-unwrap"

const FILE_KEY_SYMBOL = Symbol.for("familychart.fileKey")

type GlobalWithFileKey = typeof globalThis & { [key: symbol]: string | undefined }

function globalStore(): GlobalWithFileKey {
  return globalThis as GlobalWithFileKey
}

function storeFileKey(passphrase: string): void {
  globalStore()[FILE_KEY_SYMBOL] = passphrase
}

function clearFileKey(): void {
  delete globalStore()[FILE_KEY_SYMBOL]
}

/** Synchronous accessor — throws if key not acquired. Never log the return value. */
export function getFileKey(): string {
  const key = globalStore()[FILE_KEY_SYMBOL]
  if (!key) {
    throw new Error("File encryption key not acquired — boot halted")
  }
  return key
}

export function hasFileKey(): boolean {
  return Boolean(globalStore()[FILE_KEY_SYMBOL])
}

/** Returns key material when present; null when encryption mode is none. */
export function getFileKeyOrNull(): string | null {
  return globalStore()[FILE_KEY_SYMBOL] ?? null
}

/** Test-only: set or clear the acquired file key (pass `null` to clear). */
export function __setFileKeyForTests(key: string | null): void {
  if (key === null) clearFileKey()
  else storeFileKey(key)
}

async function unwrapFileKeyFromKeyserver(): Promise<string> {
  const wrappedKey = process.env.FILE_WRAPPED_KEY?.trim()
  if (!wrappedKey) {
    throw new Error("keyserver mode requires FILE_WRAPPED_KEY")
  }
  return unwrapKeyFromKeyserver({ wrappedKey, label: "file" })
}

function resolveEnvFileKey(): string {
  const key = process.env.FC_FILE_KEY?.trim()
  if (!key) {
    throw new Error("env encryption mode requires FC_FILE_KEY")
  }
  return key
}

async function acquireForMode(mode: EncryptionMode): Promise<void> {
  switch (mode) {
    case "none":
      clearFileKey()
      return
    case "env":
      storeFileKey(resolveEnvFileKey())
      return
    case "keyserver":
      storeFileKey(await unwrapFileKeyFromKeyserver())
      return
  }
}

/**
 * Acquire the file-at-rest passphrase at Node boot. Fail-closed on any error in
 * encryption-active modes (same gate as the DB key).
 */
export async function acquireFileKey(): Promise<void> {
  const mode = getEncryptionMode()
  if (!encryptionActive(mode)) {
    clearFileKey()
    return
  }
  await acquireForMode(mode)
}
