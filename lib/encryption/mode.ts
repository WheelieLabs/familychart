// SPDX-License-Identifier: AGPL-3.0-only

export type EncryptionMode = "none" | "env" | "keyserver"

const VALID: EncryptionMode[] = ["none", "env", "keyserver"]

/** Parse `FC_ENCRYPTION_MODE`; default `none` for self-host. */
export function getEncryptionMode(): EncryptionMode {
  const raw = process.env.FC_ENCRYPTION_MODE?.trim().toLowerCase()
  if (!raw || raw === "none") return "none"
  if (raw === "env" || raw === "keyserver") return raw
  throw new Error(`Invalid FC_ENCRYPTION_MODE: ${raw} (expected none, env, or keyserver)`)
}

export function encryptionActive(mode: EncryptionMode = getEncryptionMode()): boolean {
  return mode === "env" || mode === "keyserver"
}

export function assertEncryptionMode(mode: EncryptionMode): void {
  if (!VALID.includes(mode)) {
    throw new Error(`Invalid encryption mode: ${mode}`)
  }
}
