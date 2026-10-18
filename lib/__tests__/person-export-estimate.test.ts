// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { applyBaselineSchema } from "@/lib/db"
import { estimatePersonExportBytes } from "@/lib/export/person-export-estimate"
import { __setUploadBlobAdapterForTests, createMemoryUploadBlobAdapter, deleteUpload } from "@/lib/uploads/store"
import { seedExportHousehold } from "./helpers/export-fixture"

describe("person export size estimate", () => {
  let db: Database.Database

  beforeEach(async () => {
    db = new Database(":memory:")
    applyBaselineSchema(db)
    __setUploadBlobAdapterForTests(createMemoryUploadBlobAdapter())
    await seedExportHousehold(db)
  })

  afterEach(() => {
    db.close()
    __setUploadBlobAdapterForTests(null)
  })

  it("counts report bytes apart from the photo and the rest of the record", async () => {
    const est = await estimatePersonExportBytes(db, 1)
    expect(est?.reportBytes).toBe("iron-pdf-bytes".length)
    expect(est!.totalBytes).toBeGreaterThan("iron-pdf-bytes".length + "alex-jpeg-bytes".length)
  })

  it("leaves a missing report out of the estimate", async () => {
    await deleteUpload("test-results", "88888888-8888-4888-8888-888888888888.pdf")
    const est = await estimatePersonExportBytes(db, 1)
    expect(est?.reportBytes).toBe(0)
  })

  it("counts a report file once when two results share it", async () => {
    db.prepare(
      "INSERT INTO test_events (person_id, test_type, name, date, attachment_url) VALUES (1, 'Blood', 'Repeat', '2026-02-01', '/api/test-results/uploads/88888888-8888-4888-8888-888888888888.pdf')",
    ).run()
    const est = await estimatePersonExportBytes(db, 1)
    expect(est?.reportBytes).toBe("iron-pdf-bytes".length)
  })

  it("returns null when the Person does not exist", async () => {
    expect(await estimatePersonExportBytes(db, 99)).toBeNull()
  })
})
