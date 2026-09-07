// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, describe, expect, it } from "vitest"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { applyCipherProfile, SQLCIPHER_PROFILE } from "@/lib/encryption/cipher-profile"

describe("applyCipherProfile", () => {
  let dbPath: string | null = null
  let db: Database.Database | null = null

  afterEach(async () => {
    db?.close()
    db = null
    if (dbPath) {
      await fs.rm(dbPath, { force: true })
      dbPath = null
    }
  })

  it("sets the pinned SQLCipher cipher and legacy compatibility pragmas", () => {
    dbPath = path.join(os.tmpdir(), `cipher-profile-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
    db = new Database(dbPath)
    applyCipherProfile(db, "correct horse battery staple")

    expect(db.pragma("cipher", { simple: true })).toBe(SQLCIPHER_PROFILE.cipher)
    expect(db.pragma("legacy", { simple: true })).toBe(String(SQLCIPHER_PROFILE.legacy))
  })

  it("round-trips a passphrase through a real encrypted file, including one containing double quotes", async () => {
    dbPath = path.join(os.tmpdir(), `cipher-profile-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
    const passphrase = 'pa"ss"word'

    const writer = new Database(dbPath)
    applyCipherProfile(writer, passphrase)
    writer.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
    writer.prepare("INSERT INTO t (v) VALUES (?)").run("hello")
    writer.close()

    const reader = new Database(dbPath)
    applyCipherProfile(reader, passphrase)
    const row = reader.prepare("SELECT v FROM t WHERE id = 1").get() as { v: string }
    expect(row.v).toBe("hello")
    reader.close()
    db = null
  })

  it("fails to read encrypted data back with the wrong passphrase", async () => {
    dbPath = path.join(os.tmpdir(), `cipher-profile-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)

    const writer = new Database(dbPath)
    applyCipherProfile(writer, "correct-passphrase")
    writer.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
    writer.prepare("INSERT INTO t (v) VALUES (?)").run("hello")
    writer.close()

    const reader = new Database(dbPath)
    applyCipherProfile(reader, "wrong-passphrase")
    expect(() => reader.prepare("SELECT v FROM t WHERE id = 1").get()).toThrow()
    reader.close()
  })
})
