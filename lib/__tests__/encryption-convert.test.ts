// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import Database from "better-sqlite3-multiple-ciphers"
import { convertDatabaseEncryption } from "@/lib/encryption/convert-orchestrator"
import { openDatabase } from "@/lib/encryption/convert"
import { crossesCipherBoundary } from "@/lib/encryption/key-config"
import type { EncryptionMode } from "@/lib/encryption/mode"

const TEST_KEY_A = "aa".repeat(32)
const TEST_KEY_B = "bb".repeat(32)

function tempDb(name: string): string {
  return path.join(os.tmpdir(), `fc-encrypt-test-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
}

function createPlainDb(filePath: string): void {
  const db = new Database(filePath)
  db.exec(`
    CREATE TABLE sample (id INTEGER PRIMARY KEY, label TEXT NOT NULL);
    INSERT INTO sample (label) VALUES ('hello');
  `)
  db.close()
}

function createEncryptedDb(filePath: string, passphrase: string): void {
  const db = openDatabase({ filePath, encrypted: true, passphrase })
  db.exec(`
    CREATE TABLE sample (id INTEGER PRIMARY KEY, label TEXT NOT NULL);
    INSERT INTO sample (label) VALUES ('secret');
  `)
  db.close()
}

function readLabel(filePath: string, encrypted: boolean, passphrase: string | null): string {
  const db = openDatabase({ filePath, encrypted, passphrase, readonly: true })
  const row = db.prepare("SELECT label FROM sample LIMIT 1").get() as { label: string }
  db.close()
  return row.label
}

const DIRECTIONS: { from: EncryptionMode; to: EncryptionMode; fromKey?: string; toKey?: string }[] = [
  { from: "none", to: "env", toKey: TEST_KEY_A },
  { from: "env", to: "none", fromKey: TEST_KEY_A },
  { from: "none", to: "keyserver", toKey: TEST_KEY_B },
  { from: "keyserver", to: "none", fromKey: TEST_KEY_B },
  { from: "env", to: "keyserver", fromKey: TEST_KEY_A, toKey: TEST_KEY_B },
  { from: "keyserver", to: "env", fromKey: TEST_KEY_B, toKey: TEST_KEY_A },
]

describe("encryption conversion matrix", () => {
  const cleanup: string[] = []

  afterEach(() => {
    for (const f of cleanup.splice(0)) {
      if (fs.existsSync(f)) fs.unlinkSync(f)
    }
  })

  for (const dir of DIRECTIONS) {
    it(`${dir.from} → ${dir.to}`, async () => {
      const source = tempDb("src")
      const target = tempDb("dst")
      cleanup.push(source, target)

      const sourceEncrypted = dir.from !== "none"
      if (sourceEncrypted) {
        createEncryptedDb(source, dir.fromKey!)
      } else {
        createPlainDb(source)
      }

      const from = {
        mode: dir.from,
        source: dir.fromKey ? ("inline" as const) : dir.from === "none" ? ("none" as const) : dir.from,
        inlinePassphrase: dir.fromKey,
      }
      const to = {
        mode: dir.to,
        source: dir.toKey ? ("inline" as const) : dir.to === "none" ? ("none" as const) : dir.to,
        inlinePassphrase: dir.toKey,
      }

      const expectedMethod = crossesCipherBoundary(from, to) ? "export" : "rekey"
      const result = await convertDatabaseEncryption({
        sourcePath: source,
        targetPath: target,
        from,
        to,
        fromPassphrase: dir.fromKey,
        toPassphrase: dir.toKey,
      })

      expect(result.method).toBe(expectedMethod)
      const targetEncrypted = dir.to !== "none"
      const label = readLabel(target, targetEncrypted, dir.toKey ?? null)
      expect(label).toBe(sourceEncrypted ? "secret" : "hello")
    })
  }

  it("hard-halts on missing passphrase for encrypted source", async () => {
    const source = tempDb("bad-src")
    cleanup.push(source)
    createEncryptedDb(source, TEST_KEY_A)

    await expect(
      convertDatabaseEncryption({
        sourcePath: source,
        targetPath: tempDb("bad-dst"),
        from: { mode: "env", source: "inline" },
        to: { mode: "none", source: "none" },
      }),
    ).rejects.toThrow()
  })

  it("does not leave partial target on export failure", async () => {
    const source = tempDb("fail-src")
    const target = tempDb("fail-dst")
    cleanup.push(source)
    createPlainDb(source)

    await expect(
      convertDatabaseEncryption({
        sourcePath: source,
        targetPath: target,
        from: { mode: "none", source: "none" },
        to: { mode: "env", source: "inline" },
      }),
    ).rejects.toThrow()

    expect(fs.existsSync(target)).toBe(false)
  })
})
