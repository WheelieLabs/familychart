// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { execFileSync } from "child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import v8 from "v8"
import vm from "vm"
import {
  BlobReader,
  configure,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
  Uint8ArrayReader,
  type FileEntry,
} from "@zip.js/zip.js"
import { applyBaselineSchema } from "@/lib/db"
import { logger } from "@/lib/logger"
import { exportsInFlight } from "@/lib/export/export-registry"
import { __setRestoreStageDirForTests } from "@/lib/restore/stage-store"
import { DAMAGED_EXPORT, UNSUPPORTED_EXPORT_ENCRYPTION, WRONG_EXPORT_PASSPHRASE } from "@/lib/restore/messages"
import { __setUploadBlobAdapterForTests, createMemoryUploadBlobAdapter } from "@/lib/uploads/store"
import { syncTestMetricCatalogue } from "@/lib/test-results/test-metric-catalogue"
import { seedExportHousehold } from "./helpers/export-fixture"

configure({ useWebWorkers: false })

vi.mock("@/lib/db", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}))

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => session),
}))

vi.mock("@/lib/email-send", () => ({
  isOutboundEmailConfigured: vi.fn(() => false),
  sendOutboundEmail: vi.fn(async () => ({ ok: true as const })),
}))

let testDb: Database.Database
let session: { user: { id: string; email: string }; sessionVersion: number } | null
let stageDir: string

const PASSPHRASE = "23456ABCDEFGHJKLMNPQ"
const GROUPED = "23456 ABCDE FGHJK LMNPQ"

function signInAsAdmin() {
  session = { user: { id: "local:1", email: "admin@example.com" }, sessionVersion: 0 }
}

async function exportPerson(passphrase: string | null, personId = 1) {
  const route = await import("@/app/api/people/[id]/export/route")
  const params = { params: Promise.resolve({ id: String(personId) }) }
  if (!passphrase) {
    return route.GET(new NextRequest(`http://localhost/api/people/${personId}/export`), params)
  }
  return route.POST(new NextRequest(`http://localhost/api/people/${personId}/export`, {
    method: "POST",
    body: JSON.stringify({ passphrase }),
    headers: { "content-type": "application/json" },
  }), params)
}

async function exportHousehold(passphrase: string) {
  const { POST } = await import("@/app/api/export/household/route")
  return POST(new NextRequest("http://localhost/api/export/household", {
    method: "POST",
    body: JSON.stringify({ passphrase }),
    headers: { "content-type": "application/json" },
  }))
}

async function upload(bytes: Buffer) {
  const { POST } = await import("@/app/api/restore/upload/route")
  return POST(new NextRequest("http://localhost/api/restore/upload", {
    method: "POST",
    body: new Uint8Array(bytes),
    headers: { "content-type": "application/zip" },
  }))
}

async function unlock(id: string, passphrase: string) {
  const { POST } = await import("@/app/api/restore/[id]/passphrase/route")
  return POST(new NextRequest(`http://localhost/api/restore/${id}/passphrase`, {
    method: "POST",
    body: JSON.stringify({ passphrase }),
    headers: { "content-type": "application/json" },
  }), { params: Promise.resolve({ id }) })
}

async function preview(id: string) {
  const { GET } = await import("@/app/api/restore/[id]/route")
  return GET(new NextRequest(`http://localhost/api/restore/${id}`), { params: Promise.resolve({ id }) })
}

function savedZip(bytes: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "fc-protected-zip-"))
  const path = join(dir, "export.zip")
  writeFileSync(path, bytes)
  return path
}

async function listed(path: string) {
  const blob = await (await import("fs")).openAsBlob(path)
  const reader = new ZipReader(new BlobReader(blob))
  try {
    return await reader.getEntries()
  } finally {
    await reader.close()
  }
}

describe("protected exports", () => {
  beforeEach(async () => {
    stageDir = mkdtempSync(join(tmpdir(), "fc-protected-stage-"))
    __setRestoreStageDirForTests(stageDir)
    __setUploadBlobAdapterForTests(createMemoryUploadBlobAdapter())
    testDb = new Database(":memory:")
    applyBaselineSchema(testDb)
    await seedExportHousehold(testDb)
    signInAsAdmin()
  })

  afterEach(() => {
    testDb.close()
    __setUploadBlobAdapterForTests(null)
    __setRestoreStageDirForTests(null)
    vi.restoreAllMocks()
  })

  it("writes an AES-256 person zip whose manifest is readable and minimal and whose other entries are encrypted", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => {})
    const res = await exportPerson(GROUPED)
    expect(res.status).toBe(200)
    const bytes = Buffer.from(await res.arrayBuffer())
    expect(bytes.includes(Buffer.from(PASSPHRASE))).toBe(false)
    const path = savedZip(bytes)
    const names = execFileSync("unzip", ["-Z1", path], { encoding: "utf8" }).trim().split("\n")
    expect(names.slice(0, 3)).toEqual(["manifest.json", "check", "contents.json"])
    for (const name of names) {
      expect(name.toLowerCase()).not.toMatch(/alex|sam|robin|example|paracetamol/)
    }
    const manifest = JSON.parse(execFileSync("unzip", ["-p", path, "manifest.json"], { encoding: "utf8" })) as Record<string, unknown>
    expect(Object.keys(manifest).sort()).toEqual(["app_version", "exported_at", "format_version", "protected", "scope"])
    expect(manifest).toMatchObject({ format_version: 2, scope: "person", protected: true })
    expect(JSON.stringify(manifest)).not.toMatch(/Alex|2015-04-02|Sam|Robin/)
    expect(() => execFileSync("unzip", ["-p", path, "csv/administrations.csv"])).toThrow()
    const entries = await listed(path)
    for (const entry of entries) {
      if (entry.filename === "manifest.json") {
        expect(entry.encrypted).toBe(false)
      } else {
        expect(entry.encrypted).toBe(true)
        expect(entry.zipCrypto).toBe(false)
        expect(entry.extraFieldAES?.strength).toBe(3)
      }
    }
    const csv = entries.find((entry): entry is FileEntry => !entry.directory && entry.filename === "csv/administrations.csv")
    const text = new TextDecoder().decode(await csv!.getData(new Uint8ArrayWriter(), { password: PASSPHRASE }))
    expect(text).toContain("Paracetamol")

    const details = JSON.parse((testDb.prepare(
      "SELECT details FROM audit_log WHERE action = 'EXPORT'",
    ).get() as { details: string }).details) as Record<string, unknown>
    expect(details.protected).toBe(true)
    expect(JSON.stringify(details)).not.toContain(PASSPHRASE)
    const logged = info.mock.calls.map(call => JSON.stringify(call)).join("\n")
    expect(logged).toContain('"protected":true')
    expect(logged).not.toContain(PASSPHRASE)
    expect(exportsInFlight(1)).toBe(0)
  })

  it("writes a protected household zip with the same rules", async () => {
    const res = await exportHousehold(PASSPHRASE)
    expect(res.status).toBe(200)
    const bytes = Buffer.from(await res.arrayBuffer())
    const path = savedZip(bytes)
    const names = execFileSync("unzip", ["-Z1", path], { encoding: "utf8" }).trim().split("\n")
    expect(names[0]).toBe("manifest.json")
    expect(names).toContain("check")
    expect(names).toContain("contents.json")
    expect(names).toContain("household.json")
    expect(names.some(name => name.startsWith("people/1/"))).toBe(true)
    for (const name of names) expect(name.toLowerCase()).not.toMatch(/alex|sam|robin/)
    const manifest = JSON.parse(execFileSync("unzip", ["-p", path, "manifest.json"], { encoding: "utf8" })) as { scope: string; protected: boolean; sections?: unknown }
    expect(manifest).toMatchObject({ scope: "household", protected: true })
    expect(manifest.sections).toBeUndefined()
    const entries = await listed(path)
    expect(entries.find(entry => entry.filename === "csv/administrations.csv" || entry.filename.endsWith("/csv/administrations.csv"))?.encrypted).toBe(true)
    const household = entries.find(entry => entry.filename === "household.json")
    expect(household?.encrypted).toBe(true)
    expect(household?.extraFieldAES?.strength).toBe(3)
  })

  it("restores a protected person export, rejects a wrong passphrase without locking, and then opens it", async () => {
    const bytes = Buffer.from(await (await exportPerson(PASSPHRASE)).arrayBuffer())
    testDb.close()
    testDb = new Database(":memory:")
    applyBaselineSchema(testDb)
    syncTestMetricCatalogue(testDb)
    testDb.prepare("INSERT INTO accounts (id, email, role) VALUES (1, 'admin@example.com', 'admin')").run()

    const staged = await upload(bytes)
    expect(staged.status).toBe(200)
    const uploaded = await staged.json() as { id: string; protected: boolean; sections: string[] }
    expect(uploaded.protected).toBe(true)
    expect(uploaded.sections).toEqual([])
    expect(JSON.stringify(uploaded)).not.toMatch(/Alex|2015-04-02/)

    const wrong = await unlock(uploaded.id, "WRONGPASSPHRASEXXXX")
    expect(wrong.status).toBe(400)
    expect(await wrong.json()).toEqual({ error: WRONG_EXPORT_PASSPHRASE })
    const again = await unlock(uploaded.id, "NOTTHISPASSPHRASEXX")
    expect(again.status).toBe(400)
    expect(await again.json()).toEqual({ error: WRONG_EXPORT_PASSPHRASE })

    const opened = await unlock(uploaded.id, GROUPED)
    expect(opened.status).toBe(200)
    const planRes = await preview(uploaded.id)
    expect(planRes.status).toBe(200)
    const plan = await planRes.json() as {
      persons: { name: string; date_of_birth: string | null; suggested_action: string; bundle_id: number; target_id: number | null }[]
      medications: { bundle_id: number; suggested_action: string; target_id: number | null }[]
    }
    expect(plan.persons.map(person => person.name)).toContain("Alex")

    const { POST } = await import("@/app/api/restore/[id]/apply/route")
    const applied = await POST(new NextRequest(`http://localhost/api/restore/${uploaded.id}/apply`, {
      method: "POST",
      body: JSON.stringify({
        persons: plan.persons.map(person => ({
          bundle_id: person.bundle_id, action: person.suggested_action, target_id: person.target_id,
        })),
        medications: plan.medications.map(medication => ({
          bundle_id: medication.bundle_id, action: medication.suggested_action, target_id: medication.target_id,
        })),
      }),
      headers: { "content-type": "application/json" },
    }), { params: Promise.resolve({ id: uploaded.id }) })
    expect(applied.status).toBe(200)
    const names = testDb.prepare("SELECT name FROM people ORDER BY name").all() as { name: string }[]
    expect(names.map(row => row.name)).toContain("Alex")
    const restore = JSON.parse((testDb.prepare(
      "SELECT details FROM audit_log WHERE action = 'RESTORE'",
    ).get() as { details: string }).details) as { protected?: boolean }
    expect(restore.protected).toBe(true)
    expect(JSON.stringify(restore)).not.toContain(PASSPHRASE)
  })

  it("refuses a tampered protected entry before anything is applied", async () => {
    const bytes = Buffer.from(await (await exportPerson(PASSPHRASE)).arrayBuffer())
    const path = savedZip(bytes)
    const entries = await listed(path)
    const person = entries.find(entry => entry.filename === "person.json")
    expect(person?.offset).toEqual(expect.any(Number))
    expect(person!.compressedSize).toBeGreaterThan(40)
    const header = bytes.subarray(person!.offset, person!.offset + 30)
    const dataStart = person!.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
    const flipped = Buffer.from(bytes)
    flipped[dataStart + person!.compressedSize - 1] ^= 0xff
    const peopleBefore = testDb.prepare("SELECT COUNT(*) AS n FROM people").get() as { n: number }
    const staged = await upload(flipped)
    expect(staged.status).toBe(200)
    const { id } = await staged.json() as { id: string }
    const opened = await unlock(id, PASSPHRASE)
    expect(opened.status).toBe(400)
    expect(await opened.json()).toEqual({ error: DAMAGED_EXPORT })
    expect((testDb.prepare("SELECT COUNT(*) AS n FROM people").get() as { n: number }).n).toBe(peopleBefore.n)
  })

  it("refuses a protected file that is not AES-256", async () => {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
    const chunks: Buffer[] = []
    const done = (async () => {
      const reader = readable.getReader()
      for (;;) {
        const { done: end, value } = await reader.read()
        if (end) break
        chunks.push(Buffer.from(value))
      }
    })()
    const zip = new ZipWriter(writable, { level: 0 })
    const enc = new TextEncoder()
    await zip.add("manifest.json", new Uint8ArrayReader(enc.encode(JSON.stringify({
      format_version: 1, scope: "person", app_version: "1.1.0", exported_at: "2026-01-01T00:00:00.000Z", protected: true,
    }))))
    await zip.add("check", new Uint8ArrayReader(enc.encode("ok")), { password: PASSPHRASE, encryptionStrength: 1 })
    await zip.add("contents.json", new Uint8ArrayReader(enc.encode("{}")), { password: PASSPHRASE, encryptionStrength: 1 })
    await zip.close()
    await done
    const staged = await upload(Buffer.concat(chunks))
    expect(staged.status).toBe(400)
    expect(await staged.json()).toEqual({ error: UNSUPPORTED_EXPORT_ENCRYPTION })
  })

  it("generates a passphrase from the unambiguous alphabet and does not store it", async () => {
    const { POST } = await import("@/app/api/export/passphrase/route")
    const first = await (await POST()).json() as { passphrase: string }
    const second = await (await POST()).json() as { passphrase: string }
    expect(first.passphrase).toMatch(/^(?:[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5} ){3}[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/)
    expect(second.passphrase).toMatch(/^(?:[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5} ){3}[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/)
    expect(first.passphrase).not.toBe(second.passphrase)
    expect(testDb.prepare("SELECT COUNT(*) AS n FROM audit_log").get()).toEqual({ n: 0 })
  })

  it("streams a large protected export without holding it in memory", async () => {
    const REPORTS = 10
    const REPORT_BYTES = 4 * 1024 * 1024
    __setUploadBlobAdapterForTests({
      ...createMemoryUploadBlobAdapter(),
      get: async (bucket, filename) => (bucket === "test-results" ? Buffer.alloc(REPORT_BYTES, filename.length) : null),
      head: async (bucket, _filename, n) => (bucket === "test-results" ? Buffer.alloc(n) : null),
    })
    const insert = testDb.prepare(
      "INSERT INTO test_events (person_id, test_type, name, date, attachment_url) VALUES (1, 'Blood', ?, '2026-01-01', ?)",
    )
    for (let i = 0; i < REPORTS; i++) insert.run(`Result ${i}`, `/api/test-results/uploads/00000000-0000-4000-8000-${String(i).padStart(12, "0")}.pdf`)

    v8.setFlagsFromString("--expose-gc")
    const gc = vm.runInNewContext("gc") as () => void
    const retained = () => {
      gc()
      return process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers
    }
    const baseline = retained()
    let peak = baseline
    const res = await exportHousehold(PASSPHRASE)
    expect(res.status).toBe(200)
    peak = Math.max(peak, retained())
    const reader = res.body!.getReader()
    let total = 0
    let nextSample = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total >= nextSample) {
        peak = Math.max(peak, retained())
        nextSample += 4 * 1024 * 1024
      }
    }
    expect(total).toBeGreaterThan(REPORTS * REPORT_BYTES)
    expect(peak - baseline).toBeLessThan(8 * REPORT_BYTES)
  }, 120_000)
})
