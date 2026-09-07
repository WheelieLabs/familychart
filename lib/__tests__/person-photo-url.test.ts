// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  isValidPersonPhotoUploadUrl,
  validatePersonPhotoUrlWrite,
} from "@/lib/person/person-photo-url"

const GOOD =
  "/api/uploads/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg"

describe("isValidPersonPhotoUploadUrl", () => {
  it("accepts uuid upload paths", () => {
    expect(isValidPersonPhotoUploadUrl(GOOD)).toBe(true)
    expect(isValidPersonPhotoUploadUrl("/api/uploads/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.PNG")).toBe(true)
  })

  it("rejects junk and path tricks", () => {
    expect(isValidPersonPhotoUploadUrl("https://evil/x.jpg")).toBe(false)
    expect(isValidPersonPhotoUploadUrl("/api/uploads/../secret.jpg")).toBe(false)
    expect(isValidPersonPhotoUploadUrl("/api/uploads/not-a-uuid.jpg")).toBe(false)
  })
})

describe("validatePersonPhotoUrlWrite", () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(":memory:")
    db.exec(`
      CREATE TABLE people (
        id INTEGER PRIMARY KEY,
        photo_url TEXT
      );
      INSERT INTO people (id, photo_url) VALUES (1, '${GOOD}'), (2, NULL);
    `)
  })

  afterEach(() => {
    db?.close()
  })

  it("allows null clear and same person keeping their URL", () => {
    expect(validatePersonPhotoUrlWrite(db, null, 1)).toEqual({ ok: true, photoUrl: null })
    expect(validatePersonPhotoUrlWrite(db, GOOD, 1)).toEqual({ ok: true, photoUrl: GOOD })
  })

  it("rejects duplicate URL on another person", () => {
    const r = validatePersonPhotoUrlWrite(db, GOOD, 2)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/already in use/)
  })

  it("rejects invalid format", () => {
    const r = validatePersonPhotoUrlWrite(db, "/api/uploads/nope.jpg", 2)
    expect(r.ok).toBe(false)
  })
})
