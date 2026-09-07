// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import type { Person } from "../domain-types"
import type { AppSession, AppUser } from "../session"

function sessionUser(
  session: AppSession | AppUser | null | undefined,
): AppUser | null | undefined {
  if (!session) return null
  if ("user" in session) return session.user
  return session as AppUser
}

function trimUid(uid: string | null | undefined): string | null {
  if (uid == null) return null
  const trimmed = uid.trim()
  return trimmed === "" ? null : trimmed
}

/**
 * Canonical account ID for request-scoped user tables (push, favourites, app state).
 * Matches NextAuth `session.user.id` after auth normalisation.
 */
export function canonicalAccountUid(
  session: AppSession | AppUser | null | undefined,
): string | null {
  return trimUid(sessionUser(session)?.id)
}

/** Session identifiers that may match `people.account_uid` (Entra `sub`, `oid`, or `local:n`). */
export function sessionAccountUids(sessionUser: AppUser | null | undefined): string[] {
  if (!sessionUser?.id) return []
  const ids: string[] = [sessionUser.id]
  const oid = sessionUser.entraOid?.trim()
  if (oid && !ids.includes(oid)) ids.push(oid)
  return ids
}

/**
 * Active Person Personal-linked to this session — matches `people.account_uid` only.
 * Undefined when the session holds no Personal-link. A Watcher's `person_notification_prefs`
 * row must never satisfy this: that fallback used to let a mere Watcher be treated as "linked".
 */
export function findPersonalLinkPerson(
  db: Database.Database,
  session: AppSession | AppUser | null | undefined,
): Person | undefined {
  const linkIds = sessionAccountUids(sessionUser(session))
  if (linkIds.length === 0) return undefined

  return db
    .prepare(
      `SELECT * FROM people
       WHERE is_active = 1 AND account_uid IN (${linkIds.map(() => "?").join(",")})
       LIMIT 1`,
    )
    .get(...linkIds) as Person | undefined
}

/**
 * True when `uid` is this person's own account link (`people.account_uid`), i.e. a Personal-link
 * — not a mere Watcher whose only relationship is a `person_notification_prefs` row.
 *
 * Hydration pacing/mute is shared across every caregiver's dashboard and the cron nudge, so a
 * Watcher must never be admitted as a settings contributor: a read-only caregiver could
 * otherwise inject their own window and silently suppress the victim's hydration reminder.
 */
export function isPersonalLinkUid(
  db: Database.Database,
  uid: string | null | undefined,
  personId: number,
): boolean {
  const trimmed = trimUid(uid)
  if (!trimmed) return false
  return (
    db
      .prepare("SELECT 1 FROM people WHERE id = ? AND account_uid = ? AND is_active = 1 LIMIT 1")
      .get(personId, trimmed) != null
  )
}

/** Person ids `uid` follows via `person_notification_prefs` — Personal-link or Watcher alike. */
export function watchedPersonIds(db: Database.Database, uid: string): number[] {
  const trimmed = uid.trim()
  if (trimmed === "") return []
  const rows = db
    .prepare("SELECT person_id FROM person_notification_prefs WHERE user_uid = ?")
    .all(trimmed) as { person_id: number }[]
  return rows.map(row => row.person_id)
}

/**
 * True when `uid` follows `personId` as a Watcher — a `person_notification_prefs` row without
 * holding that person's Personal-link (push auto-subscribe plants a prefs row for the
 * Personal-link account too, so a prefs row alone is not sufficient).
 */
export function isWatcherOfPerson(
  db: Database.Database,
  uid: string | null | undefined,
  personId: number,
): boolean {
  const trimmed = trimUid(uid)
  if (!trimmed) return false
  if (isPersonalLinkUid(db, trimmed, personId)) return false
  return (
    db
      .prepare(
        "SELECT 1 FROM person_notification_prefs WHERE user_uid = ? AND person_id = ? LIMIT 1",
      )
      .get(trimmed, personId) != null
  )
}

/**
 * `user_settings` key for hydration pacing / mute / nudge for a person.
 *
 * Only the person's own Personal-link account (`people.account_uid`) may be the shared settings
 * bucket. A caller that is merely a Watcher of the person (a `person_notification_prefs` row
 * that is not `people.account_uid`) keeps its own uid and never reads or writes the shared
 * bucket, closing the read-only-caregiver hydration poison. The legacy push-account
 * fallback was retired here — ownership is authoritative via `people.account_uid`.
 */
export function resolveHydrationSettingsUid(
  db: Database.Database,
  person: Pick<Person, "id" | "account_uid">,
  sessionCanonicalUid?: string | null,
): string | null {
  const personUid = trimUid(person.account_uid)

  const sessionCanonical = trimUid(sessionCanonicalUid)
  if (sessionCanonical) {
    // The caller is the shared person bucket only when they are a genuine Personal-link;
    // otherwise (a Watcher acting via /me) they stay on their own uid.
    if (personUid && isPersonalLinkUid(db, sessionCanonical, person.id)) return personUid
    return sessionCanonical
  }

  return personUid
}

/**
 * Account key for person-scoped settings (hydration config, mute, record-anchor).
 * Uses the hydration settings bucket when a Personal-link person exists; otherwise canonical
 * account id.
 */
export function linkedPersonAccountUid(
  db: Database.Database,
  session: AppSession | AppUser | null | undefined,
): string | null {
  const person = findPersonalLinkPerson(db, session)
  if (!person) return canonicalAccountUid(session)
  return resolveHydrationSettingsUid(db, person, canonicalAccountUid(session))
}

/** Cron/dashboard hydration key for a Personal-linked person row. */
export function hydrationAccountUidForPerson(
  db: Database.Database,
  person: Pick<Person, "id" | "account_uid">,
): string | null {
  return resolveHydrationSettingsUid(db, person)
}

/**
 * Account uids whose hydration pacing rows may be merged for a Personal-linked person.
 * Cron (no session) always includes `people.account_uid`. With a session, only a
 * Personal-link caller merges that shared bucket; prefs-only Watchers get their
 * own uid only.
 */
export function hydrationSettingsCandidateUids(
  db: Database.Database,
  person: Pick<Person, "id" | "account_uid">,
  session?: AppSession | AppUser | null,
): string[] {
  // When a session is present, only a genuine Personal-link may merge the shared bucket
  // (people.account_uid). A prefs-only Watcher — including after Entra demotion where the
  // session and planted prefs remain — must read only their own uid settings.
  if (session) {
    const user = sessionUser(session)
    const linkIds = sessionAccountUids(user)
    const callerIsPersonalLink = linkIds.some((id) => isPersonalLinkUid(db, id, person.id))
    if (!callerIsPersonalLink) {
      const own = new Set<string>()
      const canonical = canonicalAccountUid(session)
      if (canonical) own.add(canonical)
      for (const id of linkIds) {
        const trimmed = trimUid(id)
        if (trimmed) own.add(trimmed)
      }
      return [...own]
    }
  }

  const uids = new Set<string>()

  const personUid = trimUid(person.account_uid)
  if (personUid) uids.add(personUid)

  if (session) {
    for (const id of sessionAccountUids(sessionUser(session))) {
      // Only the caller's own ids that are genuinely a Personal-link of THIS person may
      // contribute settings — a Watcher's session ids are excluded.
      if (isPersonalLinkUid(db, id, person.id)) {
        const trimmed = trimUid(id)
        if (trimmed) uids.add(trimmed)
      }
    }
  }

  // person_notification_prefs rows are Watcher links, not aliases of people.account_uid. Only a
  // pref uid that is itself a Personal-link of the person may join the hydration merge, so a
  // mere Watcher can never poison the person's shared pacing signal.
  const prefRows = db
    .prepare("SELECT DISTINCT user_uid FROM person_notification_prefs WHERE person_id = ?")
    .all(person.id) as { user_uid: string }[]
  for (const row of prefRows) {
    const trimmed = trimUid(row.user_uid)
    if (!trimmed) continue
    if (!isPersonalLinkUid(db, trimmed, person.id)) continue
    uids.add(trimmed)
  }

  return [...uids]
}
