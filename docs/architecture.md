# Architecture

Technical reference for contributors: stack, layout, database, auth, patterns, and background jobs.

**Version:** See [`package.json`](../package.json) (also `APP_VERSION` in [`lib/version.ts`](../lib/version.ts)).

For setup, env vars, and roles see [`README.md`](../README.md). For dev workflow see [`CONTRIBUTING.md`](../CONTRIBUTING.md). For durable decisions see [`docs/adr/`](adr/).

### Settings (planned and partial)

Instance configuration uses a typed settings registry with env-wins precedence (`app_settings` table). See [ADR-0001](adr/0001-settings-registry.md), env inventory [ADR-0006](adr/0006-environment-variable-inventory.md), reverse-proxy mode [ADR-0007](adr/0007-reverse-proxy-mode.md). **Implemented in UI:** `locale.default_timezone`, `locale.measurement_system`, and `schedule.*` in Admin → System Settings. **Registry declared (Wave 6):** auth Entra block, security policy, SMTP, VAPID — UI/wiring shipped across a series of follow-up issues.

**Measurement system:** `locale.measurement_system` (`metric` \| `imperial`) pre-selects units on the record-observation form. Values store literally; charts, goals, and observation summaries convert at display time to the locale canonical unit. History tables keep the original entered value + unit.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 6, strict mode |
| UI | React 19, Tailwind CSS v4 |
| Database | SQLite via better-sqlite3-multiple-ciphers 13 (raw SQL, no ORM) |
| Auth | NextAuth 5 beta (v5.0.0-beta.32) — Microsoft Entra ID (OIDC) + local credentials (bcryptjs) |
| Email | nodemailer 9 (managed outbound via Microsoft Graph, SMTP settings) |
| Runtime | Node 24 |
| Deployment | Docker (multi-stage, standalone output) |

---

## Project structure

```
proxy.ts                   # Next.js proxy (formerly middleware): first-run redirect to /setup, auth redirect, MFA enrollment paths, security headers. Node runtime; `getDb()` allowed. Setup-complete is `isSetupComplete(getDb())` in-process (not `GET /api/setup/status`); DB open/read errors treat the instance as incomplete. Matcher excludes `/api/setup/*` (setup-phase invariant — each setup route enforces its own auth; see ADR-0002). Unauthenticated `/reset-password` and `/accept-invite` stay in-matcher (`isSessionExemptPage`) so fragment tokens are not dropped by a redirect.
next.config.ts             # Standalone output; legacy redirects (/admin/*, old person sub-routes)
app/
  api/                     # REST API route modules (53 `route.ts` files under app/api)
    auth/                  # NextAuth catch-all
    dashboard/ health/ records/ observations/ upload/ import/
    people/ medications/ medication-groups/ medication-frequency-rules/
    observation-type-config/ management/ local-users/ accounts/  # local-users: legacy re-exports / redirect
    me/                    # Session user, password, linked person, MFA (TOTP), hydration config
    setup/ uploads/ cron/ app-settings/ favourites/ whats-new/
  profile/                 # Signed-in account: password, optional MFA enrollment
  [personId]/              # Dynamic person pages (actions, history, record, schedules-goals)
  (writable)/              # Route group gated by `canManage` (Manager or Admin) — not ReadWrite-only
    management/            # Hub: people, medications/groups/rules, import, observation types
    admin/                 # Admin-only: overview, accounts (legacy /admin/local-users redirects here)
  login/ denied/           # Auth pages
  reset-password/          # Managed-admin first-login set-password (token in URL fragment)
  accept-invite/           # Local-password invite acceptance (token in URL fragment; session-exempt)
  setup/                   # First-run wizard (no session for step 1; proxy allows /setup until setup_complete)
  page.tsx                 # Home dashboard; `?welcome=1` shows Getting started card
  layout.tsx               # Root layout (PWA metadata, deploy refresh, app lock provider)
  globals.css              # Tailwind imports + CSS custom properties

lib/
  domain-types.ts           # Shared row/API TypeScript interfaces; safe for client `import type`
  db.ts                     # SQLite connection, canonical schema in `initialiseSchema`, startup hook, query helpers
  auth.ts                   # NextAuth config (Entra ID + local credentials, 7-day sessions)
  auth-helpers.ts           # Route auth seams: requireAuth/Read/Write/Manage/Admin + authorisePersonAccess(db, ctx, personId, mode) — loads person and checks RBAC/personal-link, always 404 on failure (opaque).
  permissions.ts            # RBAC: role ladder, `canManage`, per-person access
  session.ts                # AppUser / AppSession types
  observation-types.ts      # Curated observation catalogue (labels, units, defaults); DB `observation_type_config` holds per-tenant is_active + seeded display metadata (see ADR-0012)
  observation-unit-conversion.ts # Display-layer metric/imperial conversion for charts and summaries
  measurement-system.ts     # resolveMeasurementSystem from locale.measurement_system
  medication-units.ts       # Shared MEDICATION_DOSAGE_UNITS catalogue
  spreadsheet-parse.ts      # CSV/matrix parse, column map, classify, importable preview rows; Import page stays chrome
  spreadsheet-import.ts     # Persistence: importRecords writes ImportRecord[] (confirm route)
  observation-staleness.ts
  observation-recurrence.ts
  observation-schedule.ts     # Expectations + last-at + next-due seam shared by API, dashboard, cron
  hydration-evaluate.ts       # evaluateHydration / createHydrationEvaluator — pacing, mute, nudge
  dashboard-person-status.ts  # evaluateDashboardPersonStatus — maps Alert readiness facts + hydration
  alert-readiness.ts          # evaluateAlertReadiness — caregiver alert facts for dashboard and cron
  dashboard-status.ts
  dashboard-client-context.ts # Client fetch helpers (e.g. dashboard schedule headers)
  calendar-context.ts         # resolveCalendarContext (row IANA → instance IANA → client offset headers) + serverAuthoritativeLocalYmd (no client headers). Used by schedule-aware routes and cron.
  schedule-reminder-suppression.ts # trySuppressNextScheduleSlot: same-day-only opt-in cancel of the next scheduled slot when recording a dose (gates on serverAuthoritativeLocalYmd)
  dashboard-schedule-context.ts # appendRecordedAtRangeFilters: converts local ymd query params to UTC bounds using client offset headers
  medication-dose-state.ts    # loadMedicationDoseState: bulk-loads PRN dose state (rules, 24h totals, last doses, fallback dosages) for a set of people. Re-exports evaluatePrnState from prn-eval.ts. Not a dashboard/cron assembler — Alert readiness composes it.
  medication-history.ts     # Person History medication tab: useMedicationHistory (fetch/keyset/save/delete) plus fmtAU / daysAgo / applyKeysetPage
  observation-history.ts    # Person History observations tab: useObservationHistory plus chartSeriesForObs, convertGoalValue, BP table rows; wraps blood-pressure-pairing
  prn-eval.ts                 # Pure evaluatePrnState — flags (atCap, coverageGap, cooldown, canDose) plus timing (resetAtMs, availableAtMs, effectiveOffsetH). Client-safe; shared by dashboard, cron, and Record Medication UI. Callers format times only when the matching flag is true. Alerts only — never a dose-write gate (see ADR-0011).
  smtp-host.ts                # SMTP host allow/deny (blocks cloud-metadata / link-local literals; LAN RFC1918 still allowed) + generic client error string.
  auth-rate-limit.ts          # In-memory login + re-auth (password/MFA) lockout keyed by IP+account / localUserId; also invite-accept and test-email.
  invite.ts                   # Invite lifecycle: create/list/resend/revoke/redeem, opaque tokens (sha256 lookup, no HMAC — see ADR-0015), Entra claim, single live/dead encoding (linkable, dead-link guard, display status)
  account-entra-match.ts      # Entra first-sign-in orchestrator: tries lib/invite.ts's claimInviteForEntra, else dedups by external_id/email or auto-creates an accounts row
  entra-graph-token.ts        # App-only Graph client-credentials (env config + cached token); shared by revalidation + access-control (not graph-mail)
  schedule-config.ts          # loadScheduleTimings / loadSlotEvaluatorConfig from app_settings registry; derives evaluator config from 3 tunable knobs + fixed 30 min push-delivery width
  schedule-slot-evaluator.ts  # Pure-function slot classifier shared by dashboard and cron. evaluateScheduledSlot(slotMs, nowMs, isSuppressed, config) → SlotStatus ("upcoming"|"due"|"overdue"|"overdue_push"|"suppressed"|"inactive"). resolveSlotMs(ctx, ymd, hhmm) resolves slot epoch via IANA tz or UTC offset. Timing config from schedule-config.ts (app_settings / env).
  medication-schedule.ts
  datetime.ts
  person-age.ts            # fractionalAgeYears / completedCalendarYears (instance-tz birthday boundaries)
  webauthn-app-lock.ts     # WebAuthn credential storage/codec + create/get option builders + adapter
  bio-lock-state.ts        # App-lock lock/unlock transition + FC_BIO_UNLOCK_KEY + useBioLockGate
  push.ts                  # Web Push delivery via web-push (VAPID); called by cron.ts
  cron.ts                  # Push reminder jobs: one Alert readiness evaluate per tick, then PRN / scheduled / observation adapters; hydration nudges stay separate
  version.ts               # APP_VERSION from package.json
  settings/
    app-settings-store.ts   # upsertAppSetting write gate + audit for app_settings
    user-settings-store.ts  # writeUserSetting write gate + audit for user_settings
  uploads/
    store.ts                # Deep upload I/O seam: read/write/delete/listMeta/migrate; FCE1 facade; test adapter swap
    disk-adapter.ts         # Raw blob I/O under uploads/{bucket}/
    memory-adapter.ts       # In-memory raw blob adapter for tests
    types.ts                # UploadBucket, UploadBlobAdapter, UploadMeta

components/
  AppHeader.tsx AppFooter.tsx AppLockProvider.tsx AppLockOverlay.tsx
  BackButton.tsx ConfirmModal.tsx EntityRowActions.tsx FcTabBar.tsx
  GettingStartedCard.tsx HomePeopleList.tsx HydrationBarChart.tsx LineChart.tsx
  MedicationSchedulesContent.tsx ObservationRemindersContent.tsx
  PersonPageActions.tsx QuickRecordSheet.tsx Toggle.tsx WhatsNewModal.tsx

scripts/
  build-changelog.mjs        # prebuild: WHATS_NEW.md → lib/changelog.generated.json
  fc-db-convert-cli.ts       # bundled into the image as /app/fc-db-convert.cjs
  fc-create-admin-cli.ts     # bundled into the image as /app/fc-create-admin.cjs (managed pre-seed)

public/
  manifest.json            # Linked from root layout (`/manifest.json`)
  icons/

data/
  familychart.db           # SQLite database (not in git)
  backups/                 # Timestamped backups
```

---

## Demo mode (platform)

Public demo instances set **`DEMO_MODE=true`** and **`FC_PLATFORM_PROFILE=demo`**. Self-hosted installs ignore `DEMO_MODE` when the platform profile is absent.

| Behaviour | Module |
|-----------|--------|
| Armed check | `lib/demo-mode.ts` — `isDemoModeActive()`, boot validation |
| Fixed MFA OTP `123456` | `lib/auth.ts` credentials provider |
| Block password/MFA/account/profile writes | respective `app/api/**` routes |
| Reject-on-write profanity | `lib/demo-profanity.ts`, `lib/demo-profanity-guard.ts` — local blocklist then purgomalum (demo only) |

See [ADR-0005](adr/0005-demo-mode-platform-guard.md). The public demo instance's seed data is generated from a separate, internal repo and must track `applyBaselineSchema()` in `lib/db.ts` — see `docs-internal/managed-hosting.md` for that cross-repo dependency.

---

## Database

- **Engine:** SQLite, single file, WAL mode, foreign keys enabled
- **Default path:** `./data/familychart.db` (override with `DB_PATH` env var)
- **ORM:** None — raw SQL with better-sqlite3 prepared statements
- **Schema:** The full DDL for new databases lives in `applyBaselineSchema()` in [`lib/db.ts`](../lib/db.ts) — the live 1.0.0 schema (`accounts`, `people.account_uid`, Invite columns, `must_reset_password`), every statement `IF NOT EXISTS` so a second `getDb()` open in one process (instrumentation vs the request bundle) never throws. On startup, [`runMigrations()`](../lib/db-migrations/index.ts) applies numbered migrations tracked in `schema_migrations` (idempotent — each runs once); the list is empty as of 1.0.0 — migrations 001–017, including the `local_users` → `accounts` unification, are folded into the baseline. A database that already recorded 016/017 in `schema_migrations` keeps those rows; they are simply no longer runnable. The next schema change after this baseline is a new migration (018+). See [ADR-0015](adr/0015-accounts-unification.md).
- **Encryption:** `FC_ENCRYPTION_MODE` (`none` | `env` | `keyserver`) protects the SQLite DB **and** upload blobs under `uploads/{bucket}/` (today: `people` for person photos) — see [ADR-0003](adr/0003-database-encryption-modes.md). DB driver: `better-sqlite3-multiple-ciphers` with pinned SQLCipher profile (`cipher=sqlcipher`, `legacy=4`). File uploads use AES-256-GCM (`FCE1` on-disk header) with a **separate** file key (`FC_FILE_KEY` / `FILE_WRAPPED_KEY`). All upload read/write/delete/list/migrate goes through the deep module [`lib/uploads/store.ts`](../lib/uploads/store.ts) (facade owns mode/key/FCE1; disk adapter under `uploads/{bucket}/`; in-memory adapter for tests). Cipher primitives stay in `lib/encryption/file-crypto.ts`. Key acquisition at boot via [`instrumentation.ts`](../instrumentation.ts) (DB key then file key; fail-closed when mode ≠ `none`). In `keyserver` mode, DB and file wrapped keys share one unwrap transport (`lib/encryption/keyserver-unwrap.ts`) while passphrase stores remain independent. Plaintext uploads are migrated on boot via `migratePlaintextUploads()`. Conversion CLI: [`scripts/fc-db-convert-cli.ts`](../scripts/fc-db-convert-cli.ts); ops runbook: [`docs/encryption-runbook.md`](encryption-runbook.md). Household file inventory/purge: `/admin/files` (`isAdmin`).
- **Soft deletes:** `is_active` flag on people, medications, and observation type catalogue rows. Never hard-delete production records.
- **Audit log:** Every write (create/update/delete) is recorded in the `audit_log` table via `auditLog()` in `lib/audit-log.ts`. Settings writes use `upsertAppSetting` (`app_settings`) and `writeUserSetting` (`user_settings`, user-initiated only — hydration bookkeeping keys skip audit). Details JSON must **not** duplicate health-record values (observation measurements, medication doses, or record comments) — see [ADR-0008](adr/0008-audit-log-coverage.md) for the full auth/security inventory and allowed metadata shape. Admins browse the trail at `/admin/audit-log` (`GET /api/admin/audit-log`, filterable). Security/admin entity types also mirror a structured `logger.audit` line to stdout for the Admin container log stream.
- **Access control (Entra):** `/admin/access-control` lists members of configured `ENTRA_GROUP_*` groups via Microsoft Graph (read-only; same app-only env credentials / token module as auth revalidation — `lib/entra-graph-token.ts`). No in-app membership mutation.

### Key tables

| Table | Purpose |
|-------|---------|
| `people` | Family members (name, DOB, color, `account_uid` for personal access — `local:<id>` or raw Entra oid) |
| `medications` | Drug catalog (name, dosage, age range, `is_active`) |
| `medication_groups` | Groups of related medications (brand variants) |
| `medication_group_members` | Many-to-many: medications ↔ groups |
| `medication_frequency_rules` | Dosing rules: intervals, 24h limits, age/weight bands, optional rule-level dosage. Medication-scoped only (`medication_id`) — group-scoped dosing rules were retired and the group-scoping column was later dropped as part of the pre-v1 schema cleanup. |
| `person_medications` | Which meds apply to which person; optional schedule JSON columns |
| `medication_records` | Dose history (person, med, `recorded_at`, dosage, `created_by`) |
| `observations` | Health measurements (`session_id`, `value_label` for multi-field types such as blood pressure) |
| `person_observation_expectations` | Recurring observation schedules (cadence, interval, recurrence config) |
| `observation_type_config` | Curated observation catalogue rows (seeded); tenant toggles `is_active` only — metadata is not manager-editable (see ADR-0012) |
| `push_endpoints` | Web Push subscription keys per user/device (`web_push_auth`, `p256dh`, …) |
| `person_notification_prefs` | Per-person, per-user notification toggles |
| `accounts` | Canonical accounts, local or Entra (`role`, `can_report`, `is_active`, `auth_method`, invite fields, TOTP secret for MFA, `must_reset_password` for the managed admin forced first-login flow, …) |
| `system_config` | Key/value settings (`setup_complete` = `1` after first-run wizard; `admin_seen` = `1` once an admin has authenticated — closes the bootstrap window on Entra-primary instances) |
| `audit_log` | Full write audit trail |
| `prn_push_requests` | Triggers a PRN (as-needed) dose reminder push when a dose is recorded |
| `push_log` | Deduplication log for cron-sent push notifications (keyed by `ref_key`) |
| `notification_log` | Per-recipient history of sent pushes (`recipient_user_id`, `person_id`, type, title, body, `sent_at`) — written at send time via `sendAndLogPush` |
| `schedule_reminder_suppressions` | Opt-in suppression of a *future* scheduled slot push (`person_medication_id`, `local_ymd`, `slot_hhmm`). Written when a user ticks "Cancel the [time] reminder" while recording a dose — only for the **server-authoritative local calendar day** in the effective IANA TZ (`lib/schedule-reminder-suppression.ts`); forged client day/clock headers cannot plant future-day rows. The dose's `recorded_at` must also fall on that local calendar day or within the slot's `isSlotClearedByDose` lead/grace window (`findNextSuppressibleSlot`). Rows older than 3 days are cleaned up by cron. (Recording the slot's own dose clears its alert/push separately, via proximity to `medication_records` — see `isSlotClearedByDose`.) |

### Key helper functions

SQLite boot (`lib/db.ts`) is a small, deep interface — open the singleton, apply the baseline schema, run migrations. It does not own domain queries; those live with the modules that already own each concept:

- `getDb()` (`lib/db.ts`) — singleton DB connection
- `auditLog(db, email, action, entityType, entityId, details)` (`lib/audit-log.ts`) — log a write
- `isSetupComplete(db)` / `setSetupComplete(db, email)` (`lib/setup-gate.ts`) — first-run wizard gate (`system_config.setup_complete`); the proxy reads this sentinel directly; `GET /api/setup/status` still returns the full wizard context for `/setup`
- `isAdminSeen(db)` / `markAdminSeen(db)` (`lib/setup-gate.ts`) — admin-seen sentinel (`system_config.admin_seen`); set on first admin-group Entra sign-in to close the unauthenticated bootstrap window
- `getObservationGoal(db, personId, observationType)` / `setObservationGoal(...)` / `deleteObservationGoal(db, personId, observationType)` (`lib/observation-goals.ts`) — per-person observation-goal CRUD
- `getTodayHydrationTotal(db, personId, startUtcIso, endUtcIso)` (`lib/hydration-evaluate.ts`) — today's hydration ml total, unit-converted
- `getLatestPersonWeightKg(db, personId)` (`lib/frequency-rule.ts`) — most recent weight (handles lb→kg)
- `getApplicableFrequencyRule(db, medicationId, ageYears, weightKg)` (`lib/frequency-rule.ts`) — picks the best-matching **medication-scoped** rule by age/weight band; group-scoped rules are not evaluated

### Person age (`lib/person-age.ts`)

Two named operations — do not collapse them:

- `fractionalAgeYears(dob, timeZone, asOf?)` — continuous age (elapsed ms ÷ 365.25 days) for catalogue / `min_age_years` / `max_age_years` gates (medications, frequency rules, observation type max age). Empty or unparseable DOB → `NaN`.
- `completedCalendarYears(dob, timeZone, asOf?)` — whole birthday-based years for display (people management) and under-18 weight UX on record-medication. **Intentional:** under-18 uses calendar years, not fractional. Leap-day DOBs (`29 Feb`) tick the new age on **1 March** in non-leap years (AU/UK convention). Empty or unparseable DOB → `NaN`.

**Timezone (birthday boundaries):** Both ops take a required IANA `timeZone`. Callers pass the instance locale clock — server via `resolveAgeTimezone(db)` (`resolveInstanceTimezone(db) ?? "UTC"` in `lib/instance-timezone.ts`); client via `instanceTimezone` on `GET /api/me` (same effective value). Empty/invalid `timeZone` arguments are treated as `UTC`. DOB is midnight in that zone; calendar “today” is the wall date of `asOf` (or now) in that zone. Age is **not** per-user hydration TZ or the caregiver’s browser TZ. Client age UX waits until `instanceTimezone` is known before computing age-dependent UI.

Schedules / calendar context may still fall through to client offset headers when no IANA is set; age does not — it uses instance tz or UTC so server gates and client UX stay aligned.
---

## Authentication and permissions

**Providers:** Two auth providers are supported simultaneously via NextAuth 5 beta:

1. **Microsoft Entra ID (OIDC)** — sign in with an Azure AD account; group membership is read from the token's `groups` claim and matched against `ENTRA_GROUP_*` env vars.
2. **Local credentials** — email + bcrypt password verified against the `accounts` table; accounts invited via `/admin/accounts`. The **first-run wizard** at `/setup` creates the initial local admin when no local admin exists and `setup_complete` is not set; afterwards new local accounts are invited by email (invitee sets their own password). Local accounts receive `local:` prefixed group strings. Login and step-up re-auth (`POST /api/me/password`, `/api/me/mfa/{setup,confirm,disable}`) share `lib/auth-rate-limit.ts` lockout; failed re-auth attempts are `auditLog`'d (`AUTH_FAILURE`). Wizard MFA confirm bumps `session_version` (revoking the pre-enroll JWT) and then re-issues a session with email + password + the just-verified TOTP; password-only `signIn` fails once `totp_secret` is set. If stage 1 is already complete and there is no session, the wizard shows sign-in rather than person/timezone (those APIs use `requireAdmin()`).

Both providers can be active at the same time; an installation can use one, the other, or both (`ENABLED_AUTH_PROVIDERS`).

**Invite-based accounts** ([ADR-0015](adr/0015-accounts-unification.md)): sending an invite inserts an `accounts` row at `status=invited` immediately (email, role, optional Person link via `people.account_uid`). The emailed token is opaque 32-byte base64url; `sha256(token)` is stored in `invite_token_hash` (plain DB lookup, **not** HMAC — unlike managed-admin reset tokens in [ADR-0014](adr/0014-managed-admin-forced-reset-first-login.md)). Expiry is a fixed 7 days; resend re-issues the token, revoke sets `invite_revoked_at` without deleting the row or clearing the Person link. Local invitees redeem at `/accept-invite` (`POST /api/accounts/invites/accept`). Entra first sign-in matches a live-or-dead pending invite by normalised email (`lib/invite.ts`'s `claimInviteForEntra`, tried first by the `lib/account-entra-match.ts` orchestrator) or auto-creates an `accounts` row (`auth_method=entra`, `external_id` = oid) as a link anchor — Entra roles still come only from group membership. Dead invites (expired or revoked) are excluded from the people-management Linked Account dropdown. Invites require outbound email (`isOutboundEmailConfigured()`). `accounts.role` is hidden in admin UI for `auth_method=entra`.

**Outbound email:** Managed profile uses Microsoft Graph only. Self-host SMTP (`email.smtp.*`) rejects cloud-metadata / link-local host literals; transport failures return a generic client error (no banner echo). `POST /api/app-settings/test-email` is rate-limited and audited. On managed instances, System Settings shows a read-only "Outbound email — Managed via environment" card with configured status and the test-email button; SMTP registry keys remain omitted (`platformLocked`).

**Role ladder** (each level includes the previous): `readonly` → `readwrite` → **`manager`** → `admin`. The **Reports** capability is separate (`canReport`), not a step on that ladder.

| Role | Entra group env var | Local group string | Capabilities |
|------|--------------------|--------------------|-------------|
| `readonly` | `ENTRA_GROUP_READONLY` | `local:read` | View people, records, observations |
| `readwrite` | `ENTRA_GROUP_READWRITE` | `local:write` | All readonly + record doses/observations for permitted people |
| **`manager`** | **`ENTRA_GROUP_MANAGER`** | **`local:manage`** | All readwrite + **Management** (`/management`): people, medication catalogue (groups and frequency rules), observation type catalogue (active/inactive), spreadsheet import (`canManage`) |
| `admin` | `ENTRA_GROUP_ADMIN` | `local:admin` | All manager + **Administration** (`/admin`: overview, accounts, etc.; `isAdmin`) |
| (reports) | `ENTRA_GROUP_REPORTS` | `local:report` (+ admin) | Report generation (`canReport`); orthogonal to the ladder |

**Personal access:** An Entra user whose session `id` or linked OID matches `people.account_uid` can read/write their own record when they would otherwise lack global `canRead` / `canWrite`. Use [`sessionAccountUids()`](../lib/account-identity.ts) when matching. Local accounts use `id = local:<db_id>`; the same linking applies if `people.account_uid` is set accordingly (optional linking). App shells and `requireRead()` admit sessions with global read **or** at least one active Personal-link match (`hasAnyReadablePerson`); users with neither still hit `/denied?reason=no-group`.

**Account identity (`lib/account-identity.ts`):** The single home for "is this Account this Person's Personal-link, or only a Watcher?" Rows in `person_notification_prefs` are **Watcher** links (caregivers following a person), not aliases of `people.account_uid` — `watchedPersonIds(db, uid)` lists the person ids a uid follows this way, and `isWatcherOfPerson(db, uid, personId)` checks a specific one (a prefs row *without* that person's Personal-link — push auto-subscribe also plants a prefs row for the Personal-link account itself, so a prefs row alone doesn't mean Watcher). `findPersonalLinkPerson(db, session)` returns the session's Personal-linked Person by `people.account_uid` match only — no fallback to `person_notification_prefs` — so a mere Watcher is never treated as linked (`findLinkedPerson`'s old prefs-fallback let exactly that happen and was deleted). Hydration/push identity is resolved per request via `resolveHydrationSettingsUid()` / `findPersonalLinkPerson()`. The hydration settings merge and bucket selection (`hydrationSettingsCandidateUids()`, `resolveHydrationSettingsUid()`) admit **only** a person's own Personal-link account — `isPersonalLinkUid(db, uid, personId)` checks `people.account_uid` — so a mere Watcher can never read or write the person's shared hydration pacing/mute (a read-only caregiver could otherwise suppress the shared reminder; the legacy push-account fallback was retired). When a session is present, `hydrationSettingsCandidateUids()` returns only the caller's own uids unless they are that Personal-link, so a prefs-only / demoted Watcher cannot `GET /api/me/hydration-config` or timezone and still merge `people.account_uid` settings. Cron (no session) continues to read the shared person bucket. Push `POST /api/push/subscribe` only auto-inserts a `person_notification_prefs` row via `findPersonalLinkPerson()` — a Watcher-only session's own registration never plants an unrelated auto-subscribe row. The boot-time `migrateAccountIdentity()` reconciliation (which promoted legacy `people.user_uid` from notification-pref uids) was **retired in 0.39.2**: inferring ownership from a Watcher pref allowed a planted Watcher to be promoted to owner. Ownership is now only ever set through explicit person management — never inferred.

**Dose-write validation (`lib/medication-record-validation.ts`):** `validateMedicationRecordWrite(db, input, options)` is the single seam for `POST`/`PATCH /api/records` and spreadsheet import. It bounds `recorded_at`/`dosage`, rejects a `dosage_unit` that does not match the catalogue unit case-insensitively (a divergent unit would escape the unit-scoped 24h rolling total), and — when `person_id` is supplied — requires an active `person_medications` link (unless `requirePersonLink: false`) and enforces the medication's age bounds against the person's date of birth. Global catalogue creation via `POST /api/import/confirm` is gated on the global `canWrite` role; a personal-link / read-only writer may import only against existing medications, and a row failing validation leaves no orphan catalogue entry. **PRN cooldown and 24h quantity/count caps are not write gates** — they drive dashboard alerts and reminders only ([ADR-0011](adr/0011-prn-rules-are-alerts-not-write-gates.md)).

**Observation-write timestamps:** `POST`/`PATCH /api/observations`, `PUT /api/observations/[id]`, and spreadsheet observation/BP import call the same `validateRecordTiming` helper so a future or implausibly old `recorded_at` cannot become “latest” and suppress overdue observation (or weight-banded PRN) reminders. Type and value checks remain in `validateObservationWrite`.

**Variable naming:** Use **`sessionUserId`** (or similar) for `session.user?.id` when passing into `canReadForPerson` / `canWriteForPerson` — it is not Entra-specific.

**Permission helpers** (`lib/permissions.ts`):
- `canRead(groups)`, `canWrite(groups)`, **`canManage(groups)`**, `isAdmin(groups)`, `canReport(groups)`
- `getUserRole(groups)` → `readonly` \| `readwrite` \| `manager` \| `admin` \| `null`
- `canReadForPerson(groups, sessionUser, personUid)`, `canWriteForPerson(groups, sessionUser, personUid)` — both call `sessionAccountUids()` from `lib/account-identity.ts`
- `hasAnyReadablePerson(peopleUserUids, groups, sessionUser)` — app-level read gate for demoted Personal-link sessions

**UI / layout enforcement:**
- **`app/(writable)/layout.tsx`** redirects to `/denied` if `!canManage(...)`. **`/management/*`** and writable **`/admin/*`** routes live here.
- **App menu** (`AppHeader`) shows Management only for `/api/me` role `manager` or `admin`.

**Enforcement pattern:**
- **Pages:** `const session = await auth()` → redirect to `/denied` or `/login` if insufficient role
- **API routes:** Return `401 Unauthorised` / `403 Forbidden` on auth failure (British spelling for JSON `error` strings is intentional)

**Session revocation (`lib/auth.ts` `jwt` callback):** Two revocation signals are evaluated per request. Local accounts are re-derived against `accounts` via `refreshLocalUserSession` (rejects on `is_active = 0` or a `session_version` bump from a password/MFA/role change). Entra sessions are checked against `auth_revalidation_status` (`lib/auth-revalidation.ts`, `getAuthRevalidationStatus` / `evaluateEntraSessionValidity`) — a generic `(provider, external_id)` table, hourly-refreshed by a background Graph poll piggybacked on `lib/cron.ts`'s dispatcher (app-only token via `lib/entra-graph-token.ts`), plus an admin-triggered instant revoke with no Graph dependency (`POST /api/admin/entra-sessions/[oid]/revoke`). After a successful poll, JWT `groups` soft-refresh from non-null `groups_json` without forcing re-login; pre-poll null `groups_json` leaves login-time claims alone. Revoke also prunes Web Push subscriptions. `ENTRA_SESSION_MAX_AGE_MINUTES` (default 480 = 8h) is the fail-safe bound — max time since the last successful revalidation (or sign-in, if never yet revalidated) — not an unconditional forced-relogin timer. See [ADR-0009](adr/0009-entra-live-revocation.md), which supersedes the earlier absolute-lifetime-only mechanism. On any revocation signal the callback **returns `null`**, which makes Auth.js clear the session cookie (`sessionStore.clean()`) and resolve `auth()` / `req.auth` to `null` — so the standard `redirect("/login")` guards fire and the user lands on the login page (a near-silent SSO bounce for Entra), **not** the `/denied?reason=no-group` screen. `/denied` is reserved for genuinely authenticated users who hold no FamilyChart group. Distinguish the two: revoked/expired → `/login`; authenticated-but-ungrouped → `/denied`.

---

## Key patterns

### Server vs client components

**Server components** (default): Pages fetch directly from SQLite via `getDb()` and check auth with `await auth()`.

```typescript
// Server component pattern
const session = await auth() as AppSession | null
if (!session) redirect("/login")
const db = getDb()
const rows = db.prepare("SELECT ...").all()
```

**Client components** (`"use client"`): Only for interactive pages (forms, charts, tabs). These call `/api/*` endpoints via `fetch` — no direct DB access. Person History (`app/[personId]/history/page.tsx`) keeps tab routing, edit-draft inputs, and confirm dialogs; medication and observation fetch/keyset/save/delete live in `lib/medication-history.ts` and `lib/observation-history.ts`. The Date tab merge stays on the page (deferred to the History display rework).

### Next.js 16 dynamic params

Route params are a **Promise** in Next.js 16 — always await them in **server** layouts/pages:

```typescript
interface Props { params: Promise<{ personId: string }> }

export default async function Page({ params }: Props) {
  const { personId } = await params  // must await
}
```

### API route pattern

```typescript
export async function GET(request: NextRequest) {
  const session = await auth() as AppSession | null
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
  const groups = session.user?.groups ?? []
  if (!canRead(groups)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  // ... query and return
}
```

### CSS custom properties (Tailwind v4)

Custom brand colours are defined as CSS variables in `app/globals.css`:

```css
--color-fc-blue: #2B7DC2
--color-fc-header: #C8DDEF
--color-fc-panel: #D8E9F5
--color-fc-ring: #88B8D8
```

Custom classes use the `fc-` prefix (e.g., `fc-blue`, `fc-panel`, `fc-scroll`).

**Surfaces:** `.fc-surface-app` is the standard scrollable blue canvas for **home**, **person** flows, and **management** tool pages. `.fc-surface-admin` is the darker canvas for **`/admin/*`**. Management hub cards use solid `bg-fc-blue-mid` / `hover:bg-fc-blue-dark`; the admin overview mirrors that pattern for actionable tiles.

### Shared TS types

Row-shaped interfaces (`Person`, `FrequencyRule`, `ObservationTypeConfig`, …) live in [`lib/domain-types.ts`](../lib/domain-types.ts). `lib/db.ts` does not re-export them — import types from `@/lib/domain-types` directly, whether in server or client code.

### User-facing copy

- **API errors:** Use British spelling where established (`Unauthorised`).
- **UI:** Short, direct English; optional emoji in nav is acceptable for a family PWA. Keep terminology aligned with roles (e.g. do not say “Read/Write” when the gate is `canManage`).

---

## Naming conventions

| Context | Convention | Example |
|---------|-----------|---------|
| Component files | PascalCase | `AppHeader.tsx`, `LineChart.tsx` |
| Route folders | kebab-case | `record-medication/`, `schedules-goals/` |
| TS variables/functions | camelCase | `personId`, `canWriteForPerson()` |
| DB tables/columns | snake_case | `medication_records`, `recorded_at` |
| TS interfaces for DB/API rows | PascalCase in `lib/domain-types.ts` | `Person`, `FrequencyRule` |
| TS session/auth types | PascalCase in `lib/session.ts` | `AppSession`, `AppUser` |
| CSS custom classes | `fc-` prefix | `fc-blue`, `fc-panel` |
| Env vars | SCREAMING_SNAKE_CASE | `DB_PATH`, `ENTRA_GROUP_ADMIN` |

---

## Environment variables

Required in `.env.local` (dev) or `.env` (Docker). Entra ID variables are only needed when using Microsoft Entra ID authentication. See [`.env.local.example`](../.env.local.example) and [`README.md`](../README.md) for the operator summary.

| Variable | Required | Purpose |
|----------|----------|---------|
| `NEXTAUTH_SECRET` | Always | Session encryption key (`openssl rand -base64 32`) |
| `NEXTAUTH_URL` | Always | Public app URL (e.g. `http://localhost:4000` in dev matching `npm run dev`) |
| `AUTH_MICROSOFT_ENTRA_ID_ID` | Entra only | Azure app registration client ID. Grant app-only `User.Read.All` + `GroupMember.Read.All` on this app registration to also enable live background revocation ([ADR-0009](adr/0009-entra-live-revocation.md)) — optional, sign-in works without it. |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | Entra only | Azure app registration client secret |
| `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID` | Entra only | Azure tenant ID |
| `ENTRA_GROUP_ADMIN` | Entra only | Entra security group OID for Admin role |
| `ENTRA_GROUP_MANAGER` | Entra only | Entra security group OID for Manager role (`canManage`) |
| `ENTRA_GROUP_READWRITE` | Entra only | Entra security group OID for ReadWrite role |
| `ENTRA_GROUP_READONLY` | Entra only | Entra security group OID for ReadOnly role |
| `ENTRA_GROUP_REPORTS` | Entra only | Entra security group OID for Reports role |
| `DB_PATH` | Optional | SQLite file path (default: `./data/familychart.db`) |
| `ENABLED_AUTH_PROVIDERS` | Deprecated | Boot-seeds `auth.entra.enabled`; credentials always on |
| `BEHIND_REVERSE_PROXY` | Optional | Unified reverse-proxy mode ([ADR-0007](adr/0007-reverse-proxy-mode.md)) |
| `TRUST_PROXY_DEPTH` | Optional | XFF trusted hops when behind proxy; default `1` |
| `NEXTAUTH_USE_SECURE_COOKIES` | Deprecated | Derive from `BEHIND_REVERSE_PROXY` |
| `VAPID_SUBJECT` | Push only | `mailto:` URI for VAPID (e.g. `mailto:admin@example.com`) |
| `VAPID_PUBLIC_KEY` | Push only | VAPID public key (base64url) |
| `VAPID_PRIVATE_KEY` | Push only | VAPID private key (base64url) |
| `CRON_MODE` | Optional | Set to `internal` to run cron jobs in-process via `instrumentation.ts` (fires every 5 min after a 30s startup delay). When unset, use an external caller hitting `GET /api/cron`. |
| `CRON_SECRET` | Optional | When set, external cron callers must send header `x-cron-secret` |
| `FC_SCHEDULE_LEAD_MINUTES` | Optional | Minutes before a slot to show amber upcoming alerts. Default: `60`. |
| `FC_SCHEDULE_OVERDUE_OFFSET_MINUTES` | Optional | Minutes after nominal slot time before overdue push. Default: `30`. |
| `FC_SCHEDULE_SLOT_ASSOCIATION_RADIUS_MINUTES` | Optional | History dose-to-slot association radius (minutes). Default: `60`. |
| `PUSH_OVERDUE_HOURS` | Optional | Legacy hours-based overdue offset when `FC_SCHEDULE_OVERDUE_OFFSET_MINUTES` unset. |
| `FC_DEFAULT_TIMEZONE` | Optional | Instance default IANA timezone; when set, locks the admin control |

---

## Push notifications and cron

Web Push is optional and requires VAPID keys. `lib/push.ts` handles delivery; `lib/cron.ts` contains the reminder jobs. Each tick loads the active People set once, calls `evaluateAlertReadiness` (`lib/alert-readiness.ts`), then the PRN / scheduled / observation jobs filter those facts. Hydration stays on its own evaluator.

- **PRN reminders** — facts with `remindAfterDue` (pending `prn_push_requests` after cooldown, not at cap; same `evaluatePrnState` seam as dashboard/UI; includes `max_hours_between` and last-dose `remind_after_hours`), notifies subscribers who enabled `notify_prn`. Recording a newer dose for the same person + medication (or sibling group, via `getGroupSiblingIds`) hard-deletes older pending `prn_push_requests` for chronologically earlier doses (`lib/prn-push-supersede.ts`, `clearSupersededPrnPushRequests`) — a stale request can no longer fire under the newer dose's cooldown clock. Cleared on record create (`POST /api/records`, spreadsheet import) and on `PATCH` only when `recorded_at` actually changes; a record never clears its own request.
- **Scheduled dose reminders** — `due` / `overdue_push` Scheduled slot facts from Alert readiness (`collectDueScheduledSlots` in `lib/schedule-slot-evaluator.ts`, timings from `lib/schedule-config.ts`: defaults 60 min upcoming lead, 30 min overdue push offset, fixed 30 min push-delivery window). Fires `notify_prescribed` during the due window and `notify_overdue` during the overdue-push window. Slots suppressed via `schedule_reminder_suppressions` are skipped, as are slots whose own dose has already been recorded within the slot's clearance window (`isSlotClearedByDose`, 3-day lookback). A medication currently blocked by its own PRN cooldown/24h cap appears as a `prnBlockedSlots` fact and does not fire a scheduled push. Users can opt-in to suppress a later slot **today** when recording a dose early ("Cancel the [time] reminder" checkbox); the API binds that to server-local today so client clock headers cannot silence future days (`trySuppressNextScheduleSlot`). Scheduled/overdue push deep links carry the per-slot `dosage` so the Record form prefills it.
- **Overdue dose reminders** — see above; fired as part of the same scheduled reminders loop.
- **Observation overdue** — overdue Observation expectation facts (`isObservationAlertEligible` in `lib/observation-schedule.ts`: overdue AND catalogue entry AND not aged out of `max_age_years`). `notify_observations`. Delivery still requires an instance IANA timezone.

`push_log` deduplicates sends via a unique `ref_key` (e.g. `prn:<record_id>`, `scheduled:<pm_id>:<ymd>:<hhmm>`).

Person-scoped pushes go through `dispatchPersonPush` → `resolveSubscribersForPerson` (always applies `pushSubscriberStillAuthorised`) → `sendAndLogPush`, which writes one `notification_log` row per distinct recipient `user_uid`. Profile → Notifications → History reads via `GET /api/me/notification-log`. `POST /api/push/test` sends without logging.

Cron runs are triggered either internally (set `CRON_MODE=internal`; `instrumentation.ts` calls `initInternalCron()` on startup) or externally via `GET /api/cron` (optional `x-cron-secret` header when `CRON_SECRET` is set).

---

## PWA deploy freshness

The installable PWA does not use an app-shell service worker. Push notifications register `public/sw-push.js` only.

After a deploy, a stale client JS bundle can leave `APP_VERSION` (baked from `package.json` at build time) out of sync with the server. That breaks What's New (`/api/whats-new` compares `last_seen_version` to server `APP_VERSION`) and the footer version label.

`components/DeployRefresh.tsx` polls unauthenticated `GET /api/version` (`Cache-Control: no-store`, excluded from the auth proxy) on mount and when the tab becomes visible. When the response version differs from the client bundle, it reloads once (30s sessionStorage cooldown to avoid tight loops if a CDN edge still serves stale assets). `sw-push.js` is unchanged.

---

## Deployment

- **Docker:** Multi-stage build → standalone Next.js output. See `Dockerfile` and `docker-compose.yml`. Tagged releases publish `linux/amd64` and `linux/arm64` images to GHCR in parallel per-arch jobs merged into one manifest (`.github/workflows/publish.yml`).
- **Reverse proxy:** Set `BEHIND_REVERSE_PROXY=true` when TLS terminates before the container ([ADR-0007](adr/0007-reverse-proxy-mode.md)).
- **Persistence:** DB file and photo uploads live in the `familychart-data` Docker volume, mounted at `/app/data` (matches the default `DB_PATH` of `./data/familychart.db` inside the container).
- **Health check:** `GET /api/health` (checks DB connectivity; in `keyserver` mode also probes keyserver reachability), polled every 30s by Docker. `200` = fully ok; keyserver-mode probe failure returns `503` (`{ status: "degraded", db: "connected", keyserver: "unreachable" }`, no error detail on the anonymous response) rather than a false `200` — the Compose healthcheck treats `200` and `503` both as container-live (DB is up), only `500`/network errors as unhealthy, since a keyserver blip must not restart a process that already unwrapped its key.
- **Deploy version:** `GET /api/version` returns `{ version }` for client bundle freshness checks (no auth).
- **Photo uploads:** Stored via `lib/uploads/store` in the `people` bucket (`<DB_PATH_DIR>/uploads/people/`), served via `/api/uploads/[filename]`. MIME/size/ACL stay at the routes; the store owns filename safety and at-rest crypto.
