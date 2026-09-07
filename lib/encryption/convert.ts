// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import fs from "fs"
import path from "path"
import { applyCipherProfile } from "./cipher-profile"
import { encryptionActive } from "./mode"

export interface OpenDbOptions {
  filePath: string
  encrypted: boolean
  passphrase?: string | null
  readonly?: boolean
}

/** Open a database with the pinned SQLCipher profile when encrypted. */
export function openDatabase(opts: OpenDbOptions): Database.Database {
  const { filePath, encrypted, passphrase, readonly = false } = opts
  const db = new Database(filePath, readonly ? { readonly: true } : undefined)
  if (encrypted) {
    if (!passphrase) throw new Error("Encrypted database requires passphrase")
    applyCipherProfile(db, passphrase)
  }
  if (!readonly) {
    db.pragma("journal_mode = WAL")
    db.pragma("foreign_keys = ON")
  }
  return db
}

/** Copy schema objects and row data from source to an empty target connection. */
export function copyDatabaseContents(sourceDb: Database.Database, targetDb: Database.Database): void {
  targetDb.exec("PRAGMA foreign_keys = OFF")

  const ddlRows = sourceDb
    .prepare(
      `SELECT type, name, sql FROM sqlite_master
       WHERE sql IS NOT NULL
         AND name NOT LIKE 'sqlite_%'
       ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 WHEN 'trigger' THEN 3 ELSE 4 END, name`,
    )
    .all() as { type: string; name: string; sql: string }[]

  for (const row of ddlRows) {
    if (row.type === "table") {
      targetDb.exec(row.sql)
      copyTableRows(sourceDb, targetDb, row.name)
    }
  }

  for (const row of ddlRows) {
    if (row.type === "index" && !row.sql.includes("sqlite_autoindex")) {
      targetDb.exec(row.sql)
    }
  }

  for (const row of ddlRows) {
    if (row.type === "trigger") {
      targetDb.exec(row.sql)
    }
  }

  targetDb.exec("PRAGMA foreign_keys = ON")
}

function copyTableRows(
  sourceDb: Database.Database,
  targetDb: Database.Database,
  tableName: string,
): void {
  const quoted = `"${tableName.replace(/"/g, '""')}"`
  const cols = (sourceDb.prepare(`PRAGMA table_info(${quoted})`).all() as { name: string }[]).map(
    (c) => c.name,
  )
  if (cols.length === 0) return

  const colList = cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(", ")
  const placeholders = cols.map(() => "?").join(", ")
  const select = sourceDb.prepare(`SELECT ${colList} FROM ${quoted}`)
  const insert = targetDb.prepare(`INSERT INTO ${quoted} (${colList}) VALUES (${placeholders})`)

  const tx = targetDb.transaction((rows: Record<string, unknown>[]) => {
    for (const row of rows) insert.run(...cols.map((c) => row[c]))
  })

  const batch: Record<string, unknown>[] = []
  for (const row of select.iterate() as Iterable<Record<string, unknown>>) {
    batch.push(row)
    if (batch.length >= 500) {
      tx(batch)
      batch.length = 0
    }
  }
  if (batch.length > 0) tx(batch)
}

/**
 * Export-based conversion across cipher boundaries (none↔env, none↔keyserver, etc.).
 * Copies schema + data (sqlcipher_export is unavailable in the pinned driver build).
 */
export function exportConvertDatabase(
  sourcePath: string,
  targetPath: string,
  sourceEncrypted: boolean,
  targetEncrypted: boolean,
  sourcePassphrase: string | null,
  targetPassphrase: string | null,
): void {
  if (fs.existsSync(targetPath)) {
    throw new Error(`Target already exists: ${targetPath}`)
  }

  const targetDir = path.dirname(targetPath)
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true })

  const absSource = path.resolve(sourcePath)
  const absTarget = path.resolve(targetPath)

  const sourceDb = openDatabase({
    filePath: absSource,
    encrypted: sourceEncrypted,
    passphrase: sourcePassphrase,
    readonly: true,
  })

  if (targetEncrypted && !targetPassphrase) {
    sourceDb.close()
    throw new Error("Encrypted target requires passphrase")
  }

  const targetDb = openDatabase({
    filePath: absTarget,
    encrypted: targetEncrypted,
    passphrase: targetPassphrase,
  })

  try {
    copyDatabaseContents(sourceDb, targetDb)
  } finally {
    sourceDb.close()
    targetDb.close()
  }
}

/**
 * In-place rekey for env↔keyserver (cipher unchanged).
 * Replaces sourcePath atomically via temp file + rename.
 */
export function rekeyDatabase(
  dbPath: string,
  currentPassphrase: string,
  newPassphrase: string,
): void {
  const absPath = path.resolve(dbPath)
  const tempPath = `${absPath}.rekey-tmp`
  if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)

  fs.copyFileSync(absPath, tempPath)
  const db = openDatabase({
    filePath: tempPath,
    encrypted: true,
    passphrase: currentPassphrase,
  })
  try {
    db.pragma("journal_mode = DELETE")
    db.pragma(`rekey = "${escapeKey(newPassphrase)}"`)
    db.close()
    fs.renameSync(tempPath, absPath)
  } catch (err) {
    db.close()
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
    throw err
  }
}

function escapeKey(passphrase: string): string {
  return passphrase.replace(/"/g, '""')
}

export function verifyDatabaseIntegrity(
  filePath: string,
  encrypted: boolean,
  passphrase: string | null,
): void {
  const db = openDatabase({ filePath, encrypted, passphrase, readonly: true })
  try {
    const row = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }
    if (row.integrity_check !== "ok") {
      throw new Error(`integrity_check failed: ${row.integrity_check}`)
    }
  } finally {
    db.close()
  }
}

export function isEncryptedMode(mode: string): boolean {
  return encryptionActive(mode as "env" | "keyserver")
}
