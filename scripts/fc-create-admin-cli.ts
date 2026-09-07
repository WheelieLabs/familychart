#!/usr/bin/env npx tsx
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Create the pre-seeded managed admin account inside a tenant database.
 * Secrets arrive via environment variables only — never argv.
 *
 * Opens the tenant DB the same way fc-db-convert does (cipher profile +
 * acquired key). Does not go through getDb() — that path also generates VAPID
 * keys and validates the full settings registry, which this one-shot must not
 * depend on.
 *
 * Usage (inside the instance container):
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... node /app/fc-create-admin.cjs
 *
 * Prints a single JSON result line to stdout. Does not send email.
 */

import path from "node:path"
import bcrypt from "bcryptjs"
import { acquireDbKey, getDbKey } from "../lib/encryption/db-key"
import { encryptionActive, getEncryptionMode } from "../lib/encryption/mode"
import { openDatabase } from "../lib/encryption/convert"
import { runMigrations } from "../lib/db-migrations"
import { ensureManagedAdmin } from "../lib/create-managed-admin"

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "familychart.db")

async function main() {
  const email = process.env.ADMIN_EMAIL ?? ""
  const password = process.env.ADMIN_PASSWORD ?? ""
  if (!email.trim()) {
    console.error("ADMIN_EMAIL is required")
    process.exit(1)
  }
  if (!password) {
    console.error("ADMIN_PASSWORD is required")
    process.exit(1)
  }

  await acquireDbKey()
  const mode = getEncryptionMode()
  const encrypted = encryptionActive(mode)
  const db = openDatabase({
    filePath: DB_PATH,
    encrypted,
    passphrase: encrypted ? getDbKey() : null,
  })
  try {
    runMigrations(db)
    const passwordHash = await bcrypt.hash(password, 12)
    const result = ensureManagedAdmin(db, email, passwordHash)
    if (!result.ok) {
      console.error(result.error)
      process.exit(1)
    }

    console.log(
      JSON.stringify({
        ok: true,
        userId: result.userId,
        created: result.created,
        mustResetPassword: result.mustResetPassword,
      }),
    )
  } finally {
    db.close()
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
