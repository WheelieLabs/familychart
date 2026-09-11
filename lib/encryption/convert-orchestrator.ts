// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { logger } from "@/lib/logger"
import { crossesCipherBoundary, resolveKeyConfigPassphrase, type KeyConfig } from "./key-config"
import { exportConvertDatabase, rekeyDatabase, verifyDatabaseIntegrity } from "./convert"
import { encryptionActive } from "./mode"

export interface ConvertOptions {
  sourcePath: string
  targetPath: string
  from: KeyConfig
  to: KeyConfig
  /** Override resolved source passphrase (CLI/testing). */
  fromPassphrase?: string
  /** Override resolved target passphrase (CLI/testing). */
  toPassphrase?: string
  /** In-place rekey writes back to sourcePath when true. */
  inPlace?: boolean
}

export interface ConvertResult {
  method: "export" | "rekey"
  sourcePath: string
  targetPath: string
}

/**
 * Convert a database between encryption key configurations.
 * Selects export vs rekey automatically.
 */
export async function convertDatabaseEncryption(opts: ConvertOptions): Promise<ConvertResult> {
  const fromPass =
    opts.fromPassphrase ?? (await resolveKeyConfigPassphrase(opts.from))
  const toPass =
    opts.toPassphrase ?? (await resolveKeyConfigPassphrase(opts.to))

  if (!crossesCipherBoundary(opts.from, opts.to)) {
    if (!encryptionActive(opts.from.mode) || !encryptionActive(opts.to.mode)) {
      throw new Error("Both configs are plaintext — nothing to convert")
    }
    if (!fromPass || !toPass) {
      throw new Error("Rekey requires source and destination passphrases")
    }
    if (opts.inPlace || opts.sourcePath === opts.targetPath) {
      rekeyDatabase(opts.sourcePath, fromPass, toPass)
      verifyDatabaseIntegrity(opts.sourcePath, true, toPass)
      logger.info("encryption_convert", {
        method: "rekey",
        from_mode: opts.from.mode,
        to_mode: opts.to.mode,
        in_place: true,
      })
      return { method: "rekey", sourcePath: opts.sourcePath, targetPath: opts.sourcePath }
    }
    const fs = await import("fs")
    if (fs.existsSync(opts.targetPath)) {
      throw new Error(`Target already exists: ${opts.targetPath}`)
    }
    fs.copyFileSync(opts.sourcePath, opts.targetPath)
    rekeyDatabase(opts.targetPath, fromPass, toPass)
    verifyDatabaseIntegrity(opts.targetPath, true, toPass)
    logger.info("encryption_convert", {
      method: "rekey",
      from_mode: opts.from.mode,
      to_mode: opts.to.mode,
      in_place: false,
    })
    return { method: "rekey", sourcePath: opts.sourcePath, targetPath: opts.targetPath }
  }

  const sourceEncrypted = opts.from.mode !== "none"
  const targetEncrypted = opts.to.mode !== "none"
  exportConvertDatabase(
    opts.sourcePath,
    opts.targetPath,
    sourceEncrypted,
    targetEncrypted,
    fromPass,
    toPass,
  )
  verifyDatabaseIntegrity(opts.targetPath, targetEncrypted, toPass)
  logger.info("encryption_convert", {
    method: "export",
    from_mode: opts.from.mode,
    to_mode: opts.to.mode,
  })
  return { method: "export", sourcePath: opts.sourcePath, targetPath: opts.targetPath }
}

export function countUserTables(db: Database.Database): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    )
    .get() as { n: number }
  return row.n
}
