// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { afterAll, describe, expect, it, vi } from "vitest"

const dataDir = mkdtempSync(join(tmpdir(), "fc-plaintext-upload-"))
const prevEnv = {
  DB_PATH: process.env.DB_PATH,
  FC_ENCRYPTION_MODE: process.env.FC_ENCRYPTION_MODE,
  FC_DB_KEY: process.env.FC_DB_KEY,
  FC_FILE_KEY: process.env.FC_FILE_KEY,
  NEXT_RUNTIME: process.env.NEXT_RUNTIME,
  CRON_MODE: process.env.CRON_MODE,
}

process.env.DB_PATH = join(dataDir, "familychart.db")
process.env.FC_ENCRYPTION_MODE = "env"
process.env.FC_DB_KEY = "11".repeat(32)
process.env.FC_FILE_KEY = "22".repeat(32)
process.env.NEXT_RUNTIME = "nodejs"
delete process.env.CRON_MODE

describe("plaintext upload boot", () => {
  afterAll(() => {
    vi.useRealTimers()
    for (const [key, value] of Object.entries(prevEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(dataDir, { recursive: true, force: true })
  })

  it("does not encrypt a plaintext upload when the app boots", async () => {
    const plain = Buffer.from("legacy-photo")
    const store = await import("@/lib/uploads/store")
    const adapter = store.createMemoryUploadBlobAdapter()
    store.__setUploadBlobAdapterForTests(adapter)
    await adapter.put("people", "legacy.jpg", plain)

    vi.useFakeTimers()
    const { register } = await import("../../instrumentation")
    await register()

    const raw = await adapter.get("people", "legacy.jpg")
    expect(raw?.equals(plain)).toBe(true)
  })
})
