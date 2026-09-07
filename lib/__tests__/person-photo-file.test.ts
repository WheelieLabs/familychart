// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, beforeEach, afterEach } from "vitest"
import Database from "better-sqlite3-multiple-ciphers"
import { deleteSupersededPersonPhoto } from "@/lib/person/person-photo-file"

describe("deleteSupersededPersonPhoto", () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(":memory:")
    db.exec(`
      CREATE TABLE people (
        id INTEGER PRIMARY KEY,
        photo_url TEXT
      )
    `)
  })

  afterEach(() => {
    db.close()
  })

  it("no-ops when previous url is null or unchanged", async () => {
    await deleteSupersededPersonPhoto(db, null, "/api/uploads/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg")
    await deleteSupersededPersonPhoto(
      db,
      "/api/uploads/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg",
      "/api/uploads/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg",
    )
  })

  it("skips delete when another person still references the url", async () => {
    const url = "/api/uploads/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg"
    db.prepare("INSERT INTO people (id, photo_url) VALUES (1, ?)").run(url)
    await deleteSupersededPersonPhoto(db, url, null)
    expect(db.prepare("SELECT photo_url FROM people WHERE id = 1").get()).toEqual({ photo_url: url })
  })
})
