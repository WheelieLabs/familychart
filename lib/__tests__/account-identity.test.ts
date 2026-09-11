import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  canonicalAccountUid,
  findPersonalLinkPerson,
  hydrationAccountUidForPerson,
  hydrationSettingsCandidateUids,
  isPersonalLinkUid,
  isWatcherOfPerson,
  linkedPersonAccountUid,
  resolveHydrationSettingsUid,
  sessionAccountUids,
  watchedPersonIds,
} from "@/lib/account/account-identity"
import type { AppSession } from "@/lib/session"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      account_uid TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE person_notification_prefs (
      person_id INTEGER NOT NULL,
      user_uid TEXT NOT NULL,
      UNIQUE(person_id, user_uid)
    );
    CREATE TABLE push_endpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_uid TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL DEFAULT 'k',
      web_push_auth TEXT NOT NULL DEFAULT 'a',
      last_used_at TEXT,
      UNIQUE(user_uid, endpoint)
    );
    CREATE TABLE user_settings (
      user_uid TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_uid, key)
    );
  `)
  return db
}

function session(overrides: Partial<AppSession["user"]> = {}): AppSession {
  return {
    expires: "2099-01-01",
    user: { id: "oid-canonical", entraOid: "oid-canonical", ...overrides },
  }
}

describe("canonicalAccountUid", () => {
  it("returns trimmed session user id", () => {
    expect(canonicalAccountUid(session())).toBe("oid-canonical")
    expect(canonicalAccountUid(session({ id: "  local:3  " }))).toBe("local:3")
  })

  it("returns null for missing or blank id", () => {
    expect(canonicalAccountUid(null)).toBeNull()
    expect(canonicalAccountUid(session({ id: "" }))).toBeNull()
    expect(canonicalAccountUid(session({ id: "   " }))).toBeNull()
  })
})

describe("sessionAccountUids", () => {
  it("returns empty array for null user", () => {
    expect(sessionAccountUids(null)).toEqual([])
  })

  it("returns the user id when no entraOid is set", () => {
    expect(sessionAccountUids({ id: "local:5", name: null, email: null, groups: [] })).toEqual(["local:5"])
  })

  it("includes entraOid when it differs from id", () => {
    const ids = sessionAccountUids({ id: "local:5", name: null, email: null, groups: [], entraOid: "entra-oid-abc" })
    expect(ids).toContain("local:5")
    expect(ids).toContain("entra-oid-abc")
  })

  it("does not duplicate id when entraOid equals id", () => {
    const ids = sessionAccountUids({ id: "same-oid", name: null, email: null, groups: [], entraOid: "same-oid" })
    expect(ids).toHaveLength(1)
  })
})

describe("findPersonalLinkPerson", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it("finds person by matching account_uid", () => {
    db.prepare("INSERT INTO people (name, account_uid) VALUES (?, ?)").run("Ben", "oid-canonical")
    const person = findPersonalLinkPerson(db, session())
    expect(person?.name).toBe("Ben")
  })

  it("returns undefined for a Watcher-only session — a prefs row is not a Personal-link", () => {
    const row = db
      .prepare("INSERT INTO people (name, account_uid) VALUES (?, ?) RETURNING id")
      .get("Ben", "legacy-sub") as { id: number }
    db.prepare(
      "INSERT INTO person_notification_prefs (person_id, user_uid) VALUES (?, ?)",
    ).run(row.id, "oid-canonical")

    expect(findPersonalLinkPerson(db, session())).toBeUndefined()
  })
})

describe("linkedPersonAccountUid", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it("returns people.account_uid for Personal-linked person", () => {
    db.prepare("INSERT INTO people (name, account_uid) VALUES (?, ?)").run("Ben", "oid-canonical")
    expect(linkedPersonAccountUid(db, session())).toBe("oid-canonical")
  })

  it("falls back to canonical account when not linked", () => {
    expect(linkedPersonAccountUid(db, session())).toBe("oid-canonical")
  })

  it("hydration PATCH key matches cron read key for a Personal-linked user", () => {
    db.prepare("INSERT INTO people (name, account_uid) VALUES (?, ?)").run("Ben", "oid-canonical")
    const person = findPersonalLinkPerson(db, session())!
    const patchKey = linkedPersonAccountUid(db, session())
    const cronKey = hydrationAccountUidForPerson(db, person)
    expect(patchKey).toBe(cronKey)
    expect(patchKey).toBe("oid-canonical")
  })

  it("cron read key is the person's own link, never a Watcher's prefs uid", () => {
    const person = db
      .prepare("INSERT INTO people (name, account_uid) VALUES (?, ?) RETURNING id, account_uid")
      .get("Ben", "legacy-sub") as { id: number; account_uid: string }
    db.prepare(
      "INSERT INTO person_notification_prefs (person_id, user_uid) VALUES (?, ?)",
    ).run(person.id, "oid-canonical")

    // The cron/dashboard read key keys off people.account_uid; a Watcher pref never hijacks it.
    expect(hydrationAccountUidForPerson(db, person)).toBe("legacy-sub")
    expect(isPersonalLinkUid(db, "oid-canonical", person.id)).toBe(false)
    expect(isWatcherOfPerson(db, "oid-canonical", person.id)).toBe(true)
    // A Watcher acting via /me keeps its own uid rather than the person bucket.
    expect(linkedPersonAccountUid(db, session())).toBe("oid-canonical")
  })
})

describe("resolveHydrationSettingsUid bucket selection", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it("never treats a mere Watcher as the settings bucket", () => {
    const person = db
      .prepare("INSERT INTO people (name, account_uid) VALUES (?, ?) RETURNING id, account_uid")
      .get("Ben", "ben-uid") as { id: number; account_uid: string }
    db.prepare(
      "INSERT INTO person_notification_prefs (person_id, user_uid) VALUES (?, ?)",
    ).run(person.id, "watcher-z")
    db.prepare(
      "INSERT INTO person_notification_prefs (person_id, user_uid) VALUES (?, ?)",
    ).run(person.id, "watcher-a")

    expect(resolveHydrationSettingsUid(db, person)).toBe("ben-uid")
    // A Watcher acting via /me resolves to its own uid, never the shared person bucket.
    expect(resolveHydrationSettingsUid(db, person, "watcher-a")).toBe("watcher-a")
  })

  it("returns the person bucket for a genuine Personal-link caller", () => {
    const person = db
      .prepare("INSERT INTO people (name, account_uid) VALUES (?, ?) RETURNING id, account_uid")
      .get("Ben", "ben-uid") as { id: number; account_uid: string }
    expect(resolveHydrationSettingsUid(db, person, "ben-uid")).toBe("ben-uid")
  })

  it("does not return a foreign caregiver uid for a watched person", () => {
    const person = db
      .prepare("INSERT INTO people (name, account_uid) VALUES (?, ?) RETURNING id, account_uid")
      .get("Child", "child-uid") as { id: number; account_uid: string }
    const other = db
      .prepare("INSERT INTO people (name, account_uid) VALUES (?, ?) RETURNING id")
      .get("Other", "other-uid") as { id: number }
    db.prepare(
      "INSERT INTO person_notification_prefs (person_id, user_uid) VALUES (?, ?)",
    ).run(person.id, "child-uid")
    db.prepare(
      "INSERT INTO person_notification_prefs (person_id, user_uid) VALUES (?, ?)",
    ).run(person.id, "caregiver-uid")
    db.prepare(
      "INSERT INTO person_notification_prefs (person_id, user_uid) VALUES (?, ?)",
    ).run(other.id, "caregiver-uid")

    expect(resolveHydrationSettingsUid(db, person)).toBe("child-uid")
  })
})

describe("hydrationSettingsCandidateUids watcher suppression", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it("excludes a single-person read-only Watcher from the merge candidates", () => {
    const person = db
      .prepare("INSERT INTO people (name, account_uid) VALUES (?, ?) RETURNING id, account_uid")
      .get("Child", "child-uid") as { id: number; account_uid: string }
    // The child's own Personal-link plus a caregiver who watches only this child.
    db.prepare(
      "INSERT INTO person_notification_prefs (person_id, user_uid) VALUES (?, ?)",
    ).run(person.id, "child-uid")
    db.prepare(
      "INSERT INTO person_notification_prefs (person_id, user_uid) VALUES (?, ?)",
    ).run(person.id, "readonly-caregiver-uid")

    const candidates = hydrationSettingsCandidateUids(db, person)
    expect(candidates).toContain("child-uid")
    expect(candidates).not.toContain("readonly-caregiver-uid")
  })

  it("Watcher-only session never merges the person's shared bucket", () => {
    // After Entra demotion the session remains valid and prefs remain planted.
    const person = db
      .prepare("INSERT INTO people (name, account_uid) VALUES (?, ?) RETURNING id, account_uid")
      .get("Victim", "victim-uid") as { id: number; account_uid: string }
    db.prepare(
      "INSERT INTO person_notification_prefs (person_id, user_uid) VALUES (?, ?)",
    ).run(person.id, "oid-canonical")

    const candidates = hydrationSettingsCandidateUids(
      db,
      person,
      session({ id: "oid-canonical", entraOid: "oid-canonical" }),
    )
    expect(candidates).toEqual(["oid-canonical"])
    expect(candidates).not.toContain("victim-uid")
  })

  it("Personal-link session still merges the shared person bucket", () => {
    const person = db
      .prepare("INSERT INTO people (name, account_uid) VALUES (?, ?) RETURNING id, account_uid")
      .get("Self", "oid-canonical") as { id: number; account_uid: string }

    // Match via entraOid while session.id differs — still a Personal-link, not Watcher-only.
    const withSession = hydrationSettingsCandidateUids(
      db,
      person,
      session({ id: "entra-sub", entraOid: "oid-canonical" }),
    )
    expect(withSession).toContain("oid-canonical")

    const cronCandidates = hydrationSettingsCandidateUids(db, person)
    expect(cronCandidates).toContain("oid-canonical")
  })

  it("isPersonalLinkUid only matches the person's own active account_uid", () => {
    const person = db
      .prepare("INSERT INTO people (name, account_uid) VALUES (?, ?) RETURNING id, account_uid")
      .get("Child", "child-uid") as { id: number; account_uid: string }
    expect(isPersonalLinkUid(db, "child-uid", person.id)).toBe(true)
    expect(isPersonalLinkUid(db, "watcher-uid", person.id)).toBe(false)
    expect(isPersonalLinkUid(db, null, person.id)).toBe(false)
  })
})

describe("watchedPersonIds", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it("returns every person id the uid follows via person_notification_prefs", () => {
    const a = db
      .prepare("INSERT INTO people (name, account_uid) VALUES (?, ?) RETURNING id")
      .get("A", "a-uid") as { id: number }
    const b = db
      .prepare("INSERT INTO people (name, account_uid) VALUES (?, ?) RETURNING id")
      .get("B", "b-uid") as { id: number }
    db.prepare(
      "INSERT INTO person_notification_prefs (person_id, user_uid) VALUES (?, ?)",
    ).run(a.id, "watcher-uid")
    db.prepare(
      "INSERT INTO person_notification_prefs (person_id, user_uid) VALUES (?, ?)",
    ).run(b.id, "watcher-uid")

    expect(watchedPersonIds(db, "watcher-uid").sort()).toEqual([a.id, b.id].sort())
  })

  it("returns an empty array when the uid has no prefs rows", () => {
    expect(watchedPersonIds(db, "nobody")).toEqual([])
  })
})

describe("isWatcherOfPerson", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it("is true for a prefs row without a Personal-link", () => {
    const person = db
      .prepare("INSERT INTO people (name, account_uid) VALUES (?, ?) RETURNING id")
      .get("Child", "child-uid") as { id: number }
    db.prepare(
      "INSERT INTO person_notification_prefs (person_id, user_uid) VALUES (?, ?)",
    ).run(person.id, "caregiver-uid")

    expect(isWatcherOfPerson(db, "caregiver-uid", person.id)).toBe(true)
  })

  it("is false for the Personal-link account, even though push auto-subscribe plants its own prefs row", () => {
    const person = db
      .prepare("INSERT INTO people (name, account_uid) VALUES (?, ?) RETURNING id")
      .get("Ben", "ben-uid") as { id: number }
    db.prepare(
      "INSERT INTO person_notification_prefs (person_id, user_uid) VALUES (?, ?)",
    ).run(person.id, "ben-uid")

    expect(isWatcherOfPerson(db, "ben-uid", person.id)).toBe(false)
  })

  it("is false with no prefs row at all", () => {
    const person = db
      .prepare("INSERT INTO people (name, account_uid) VALUES (?, ?) RETURNING id")
      .get("Child", "child-uid") as { id: number }
    expect(isWatcherOfPerson(db, "stranger-uid", person.id)).toBe(false)
  })

  it("is false for null/blank uid", () => {
    const person = db
      .prepare("INSERT INTO people (name, account_uid) VALUES (?, ?) RETURNING id")
      .get("Child", "child-uid") as { id: number }
    expect(isWatcherOfPerson(db, null, person.id)).toBe(false)
    expect(isWatcherOfPerson(db, "  ", person.id)).toBe(false)
  })
})
