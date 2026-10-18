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
| Language | TypeScript, strict mode. `npm run typecheck` runs the native 7.x compiler (`typescript-native`, invoked by path because the 6.x shim's `tsc` bin takes the `.bin/tsc` link); `typescript` is aliased to the `@typescript/typescript6` compat shim, so `typescript-eslint`, `next build`'s own typecheck and editors use 6.x |
| UI | React 19, Tailwind CSS v4 |
| Database | SQLite via better-sqlite3-multiple-ciphers 13 (raw SQL, no ORM) |
| Auth | NextAuth 5 beta (v5.0.0-beta.32) — Microsoft Entra ID (OIDC) + local credentials (bcryptjs) |
| Email | nodemailer 10 (managed outbound via Microsoft Graph, SMTP settings) |
| Runtime | Node 24 |
| Deployment | Docker (multi-stage, standalone output) |

---

## Project structure

```
proxy.ts                   # Next.js proxy (formerly middleware): first-run redirect to /setup, auth redirect, MFA enrollment paths, security headers. Node runtime; `getDb()` allowed. Setup-complete is `isSetupComplete(getDb())` in-process (not `GET /api/setup/status`); DB open/read errors treat the instance as incomplete. Until setup is complete, an authenticated administrator may open `/setup` and `/admin/export` only (`isPageAllowedBeforeSetupComplete`); the Person step links there so a desktop can restore an export instead of creating a first person. The wizard step list is unchanged, and once any person exists the wizard opens on the timezone step. Matcher excludes `/api/setup/*` (setup-phase invariant — each setup route enforces its own auth; see ADR-0002). Unauthenticated `/reset-password` and `/accept-invite` stay in-matcher (`isSessionExemptPage`) so fragment tokens are not dropped by a redirect.
next.config.ts             # Standalone output; security headers for routes the proxy matcher skips
app/
  api/                     # REST API route modules (90 `route.ts` files under app/api)
    auth/                  # NextAuth catch-all
    dashboard/ health/ records/ observations/ upload/ import/
    people/ medications/ medication-groups/ medication-frequency-rules/
    observation-type-config/ management/ accounts/
    me/                    # Session user, password, linked person, MFA (TOTP), hydration config
    setup/ uploads/ cron/ app-settings/ favourites/ whats-new/
  profile/                 # Signed-in account: password, optional MFA enrollment
  dose-missed/             # GET Missed slots for the History feed (slot outcomes, plus "Not given" answers from before they were stored) (`person_id`, `from`, `to`, optional `medication_id`)
  dose-expectations/       # Parent-defined away-from-home doses: PATCH/DELETE `[id]`, `[id]/exceptions` (skip days), `[id]/resolve` (inline Yes / No / Not yet); list/create under `api/people/[id]/dose-expectations`
  diagnostics/             # Diagnostics index (linked from the footer via components/DiagnosticsLink.tsx) + App lock probe tool; any signed-in Account
  [personId]/              # Dynamic person pages (actions, history, record, schedules-goals)
  (writable)/              # Route group gated by `canManage` (Manager or Admin) — not ReadWrite-only
    management/            # Hub: people, medications/groups/rules, import, observation types
    admin/                 # Admin-only: overview, accounts
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
  auth-helpers.ts           # Route auth seams: requireAuth/Read/Write/Manage/Admin + authorisePersonAccess(db, ctx, personId, mode) and authoriseReportSubject(db, ctx, personId) — load the person and check access, always 404 on failure (opaque).
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
  dashboard-medication-timeline.ts # buildMedicationTimelines — per-person `medicationTimeline` lanes on the /api/dashboard payload (rendered on the person page; `/<person>?timeline=<feed row id>` highlights a marker) (cap/cooldown via alert-readiness `evaluateMedicationPrnState` for every lane, scheduled slots enumerated across the trailing window + 6h lookahead)
  dashboard-person-status.ts  # evaluateDashboardPersonStatus — maps Alert readiness facts + hydration
  alert-readiness.ts          # evaluateAlertReadiness — caregiver alert facts for dashboard and cron
  dashboard-status.ts         # DashboardStatus red | amber | notice | green; issue kinds incl. symptom_open_pending (severity notice, inline-answered, never push)
  dashboard-client-context.ts # Client fetch helpers (e.g. dashboard schedule headers)
  calendar-context.ts         # resolveCalendarContext (row IANA → instance IANA → client offset headers) + serverAuthoritativeLocalYmd (no client headers). Used by schedule-aware routes and cron.
  dashboard-schedule-context.ts # appendRecordedAtRangeFilters: converts from/to ymd query params to UTC bounds: client offset headers when sent, otherwise the instance timezone (UTC when unset)
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
  schedule-slot-evaluator.ts  # Pure-function slot classifier shared by dashboard and cron. evaluateScheduledSlot(slotMs, nowMs, config) → SlotStatus ("upcoming"|"due"|"overdue"|"overdue_push"|"inactive"). resolveSlotMs(ctx, ymd, hhmm) resolves slot epoch via IANA tz or UTC offset. Timing config from schedule-config.ts (app_settings / env).
  medication-schedule.ts
  datetime.ts
  person-age.ts            # fractionalAgeYears / completedCalendarYears (instance-tz birthday boundaries)
  webauthn-app-lock.ts     # WebAuthn credential storage/codec (versioned, ADR-0016 device-bound "discouraged" residentKey) + create/get option builders + adapter + failure-report builder
  bio-lock-state.ts        # App-lock state machine (left/returned/fresh-start/in-app-navigation/session-(un)confirmed/explicit-unlock/settings-changed) + FC_BIO_UNLOCK_KEY + useBioLockGate + grace-period/opt-out storage
  schedule/dose-expectation.ts          # Pure applicability + pending derivation for dose expectations
  schedule/dose-expectation-store.ts    # Loads expectations, exceptions and outcomes
  schedule/dose-expectation-input.ts    # Validates a parent-entered expectation (slot in schedule, real dates, weekdays)
  schedule/dose-expectation-resolve.ts  # resolveDoseExpectation — given (real dose via recordDose) / missed / not yet
  medication/record-dose.ts             # recordDose — the single write path for a dose (validate, link, insert, label against its slot, settle Missed, supersede PRN pushes)
  schedule/slot-outcomes.ts             # slot outcomes store — classifyAndAttachDose, answerDoseTiming, settleSlots (On time / Early / Late / Missed)
  schedule/slot-outcome-reads.ts        # display reads of slot outcomes — loadDoseTimingByRecord (History, timeline), loadMissedSlots (History Missed rows, dashboard line)
  medication/dose-timing-display.ts     # DoseTiming, "41 min late" / "38 min early" wording, slot time formatting
  dashboard/dashboard-missed-slots.ts   # listDashboardMissedSlots — slots that became Missed today, shown as a quiet line (not an alert)
  schedule/dose-timing-prompt.ts        # Wording and options for the "Which dose was this?" prompt (pure; rendered by components/TimingPromptBanner.tsx on the record screen)
  medication/medication-timeline.ts # Pure timeline lane builder (markers, PRN cooldown/cap bands); flags via history/feed medicationFlag
  medication/timeline-axis.ts # Pure axis helpers: 3-hourly local ticks, midnights (DST-safe), relative-time wording; the timeline shows times in the device timezone and locale, and tapping a marker selects it (time strip) before a second tap opens the record
  hydration/hydration-presets.ts # Hydration quick-pick presets, favourite amount validation, favourite → record-page href
  app-lock-diagnostics.ts  # Probe option sets A–D and authenticator-data parsers for Diagnostics → App lock
  app-lock-opt-out.ts      # When the lock screen may offer "Turn off App lock on this device"
  app-lock-navigation.ts   # Unlock-target resolution, pending-URL + picker-suppression (2 min cap) + left-at bookkeeping for the App lock grace period
  app-lock/
    app-lock-reauth.ts     # isEntraAppLockReauthFresh / resolveEntraAuthTimeMs: Entra step-up re-auth gate, decided from the id_token auth_time (ADR-0016)
  push.ts                  # Web Push delivery via web-push (VAPID); called by cron.ts; acknowledgement pushes incl. the recorder's own "You gave…"
  cron.ts                  # Push reminder jobs: one Alert readiness evaluate per tick, then PRN / scheduled / observation adapters; hydration nudges stay separate
  version.ts               # APP_VERSION from package.json
  settings/
    app-settings-store.ts   # upsertAppSetting write gate + audit for app_settings
    user-settings-store.ts  # writeUserSetting write gate + audit for user_settings
  uploads/
    store.ts                # Deep upload I/O seam: read/write/delete/exists/listMeta; FCE1 facade; test adapter swap
    disk-adapter.ts         # Raw blob I/O under uploads/{bucket}/
    memory-adapter.ts       # In-memory raw blob adapter for tests
    types.ts                # UploadBucket, UploadBlobAdapter, UploadMeta
  export/
    export-manifest.ts      # Export format version, manifest types, protected-export header/contents split (ADR-0024)
    export-passphrase.ts    # Generated export passphrase: alphabet, grouping, normalisation
    export-zip-stream.ts    # Streamed zip builder shared by the exports: one entry at a time, compressed files stored
    protected-entries.ts    # Names of the encrypted check entry and the encrypted manifest contents
    protected-zip.ts        # AES-256 zip writer for a protected export: manifest first and unencrypted
    export-registry.ts      # Per-Person count of export streams in flight, for erase to check
    household-export.ts     # buildHouseholdExport: household.json plus one Person folder per Person
    portable-user-settings.ts # Durable per-user preferences in the export: timezone, hydration pacing, notification booleans
    export-size.ts          # Shared size sentence and the 100 MB proxy warning
    person-export-estimate.ts # Attachment bytes for one Person export
    download-person-export.ts # In-page Person download that records a finished stream
  restore/
    zip-file.ts             # Reads one staged zip from its central directory, one entry at a time
    protected-zip.ts        # Opens an AES-256 export after the passphrase check, then rewrites it for the restore engine
    stage-store.ts          # Streams an upload to a temporary file, enforces the size limit, expires old uploads
    zip-file.ts             # Bounded zip reader: sizes checked against the file before allocation, capped inflation
    restore-engine.ts       # Plan and apply: mapping, duplicate keys, catalogue flags, the restore write path
    restore-user-settings.ts # Applies portable per-user preferences; target wins; Person Sign-in outcomes
    apply.ts                # One database transaction, then this restore's files, with cleanup if a write fails
    messages.ts             # Refusal text for a missing manifest, a newer format, and demo mode
  person/
    person-export.ts        # buildPersonExport: manifest, person.json, readable CSVs, neutral attachment names
    person-export-payload.ts # Structured Person payload with bundle-local ids
    person-erase.ts         # erasePerson: hard-delete one Person, blank audit content, then delete files
    person-erase-preview.ts # Counts and backup notice for the erase confirmation; does not delete

components/
  AppHeader.tsx AppFooter.tsx AppLockProvider.tsx AppLockOverlay.tsx
  ConfirmModal.tsx EntityRowActions.tsx FcTabBar.tsx
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
| Armed check | `lib/demo/demo-mode.ts` — `isDemoModeActive()`, boot validation |
| Fixed MFA OTP `123456` | `lib/auth.ts` credentials provider |
| Block password/MFA/account/profile writes | respective `app/api/**` routes |
| Reject-on-write profanity | `lib/demo/demo-profanity.ts`, `lib/demo/demo-profanity-guard.ts` — local blocklist then purgomalum (demo only) |

See [ADR-0005](adr/0005-demo-mode-platform-guard.md). The public demo instance's seed data is generated from a separate, internal repo and must track `applyBaselineSchema()` in `lib/db.ts` — see `docs-internal/managed-hosting.md` for that cross-repo dependency.

---

## Database

- **Engine:** SQLite, single file, WAL mode, foreign keys enabled
- **Default path:** `./data/familychart.db` (override with `DB_PATH` env var)
- **ORM:** None — raw SQL with better-sqlite3 prepared statements
- **Schema:** The full DDL for new databases lives in `applyBaselineSchema()` in [`lib/db.ts`](../lib/db.ts) — the live 1.0.0 schema (`accounts`, `people.account_uid`, Invite columns, `must_reset_password`), every statement `IF NOT EXISTS` so a second `getDb()` open in one process (instrumentation vs the request bundle) never throws. On startup, [`runMigrations()`](../lib/db-migrations/index.ts) applies numbered migrations tracked in `schema_migrations` (idempotent — each runs once); migrations 001–017, including the `local_users` → `accounts` unification, are folded into the baseline. A database that already recorded 016/017 in `schema_migrations` keeps those rows; they are simply no longer runnable. All schema changes after the 1.0.0 baseline go through a migration, not just an `applyBaselineSchema()` edit — the baseline stays a readable snapshot of "what a fresh install looks like," but only `runMigrations()` reliably reaches every existing database. The first post-baseline migration is `018_medication_records_administered_by` (adds who-administered-the-dose tracking) — since `applyBaselineSchema()` also carries the column for fresh installs, the migration guards with a `PRAGMA table_info` check rather than assuming the column is missing (SQLite has no `ADD COLUMN IF NOT EXISTS`); this pattern — DDL added to the baseline **and** a migration for pre-existing installs — is the template for every later change. `019_test_results` (adds `test_metric_config`/`test_events`/`test_result_values`) is the first `CREATE TABLE` example: no existence guard needed beyond `IF NOT EXISTS`, since (unlike `ALTER TABLE`) that's already naturally idempotent. `020_symptom_events` (adds `symptom_events`) follows the same `CREATE TABLE` template. `021_dose_expectations` adds the three dose-expectation tables. `023_test_metric_catalogue` adds the catalogue columns and `limit_qualifier`, then upserts the curated catalogue; `024_symptom_events_notes` adds `symptom_events.notes`; `025_symptom_events_ongoing_confirmed_on` adds the local day an Open symptom was last confirmed as still ongoing; `026_test_metric_catalogue_additions` re-syncs the catalogue for five analytes and a few aliases. `028_normalise_twice_daily_schedule_frequency` rewrites stored `person_medications.schedule_frequency` JSON that still uses the retired alias so the kind is `daily` (a daily schedule already accepts any number of dose times). `029_entra_removed_accounts` adds the Entra removal tombstone (`oid_hash`, `removed_at`). `030_slot_outcomes` adds `slot_outcomes`. `031_audit_log_entity_index` indexes `audit_log(entity_type, entity_id)`, which Person erase uses to blank the audit rows of each record it deletes (without it, erase time grew with records times audit rows). `032_drop_schedule_reminder_suppressions` drops the retired "cancel the next slot" table and the History association radius setting. `033_test_events_dedupe_index` indexes `test_events(person_id, date, name)` for restore's duplicate check. `034_person_medication_schedule_created_at` adds `person_medications.schedule_created_at_ms` (see Schedule creation boundary under Push notifications and cron). See [ADR-0015](adr/0015-accounts-unification.md) and [ADR-0027](adr/0027-account-removal.md).
- **Encryption:** `FC_ENCRYPTION_MODE` (`none` | `env` | `keyserver`) protects the SQLite DB **and** upload blobs under `uploads/{bucket}/` (`people` for person photos, `test-results` for test-result report attachments) — see [ADR-0003](adr/0003-database-encryption-modes.md). DB driver: `better-sqlite3-multiple-ciphers` with pinned SQLCipher profile (`cipher=sqlcipher`, `legacy=4`). File uploads use AES-256-GCM (`FCE1` on-disk header) with a **separate** file key (`FC_FILE_KEY` / `FILE_WRAPPED_KEY`). All upload read/write/delete/exists/list goes through the deep module [`lib/uploads/store.ts`](../lib/uploads/store.ts) (facade owns mode/key/FCE1; disk adapter under `uploads/{bucket}/`; in-memory adapter for tests). Cipher primitives stay in `lib/encryption/file-crypto.ts`. Key acquisition at boot via [`instrumentation.ts`](../instrumentation.ts) (DB key then file key; fail-closed when mode ≠ `none`). In `keyserver` mode, DB and file wrapped keys share one unwrap transport (`lib/encryption/keyserver-unwrap.ts`) while passphrase stores remain independent. A non-`FCE1` file in an encrypted bucket is refused on read and is not rewritten at boot. Conversion CLI: [`scripts/fc-db-convert-cli.ts`](../scripts/fc-db-convert-cli.ts); ops runbook: [`docs/encryption-runbook.md`](encryption-runbook.md). Household file inventory/purge: `/admin/files` (`isAdmin`).
- **Open symptom prompt:** an Open symptom (`is_resolved = 0` and no `end_date`) raises a `symptom_open_pending` dashboard issue from the day after it started, built by [`lib/symptoms/open-symptom-prompts.ts`](../lib/symptoms/open-symptom-prompts.ts) (not by Alert readiness, so cron never sees it). Its severity is `notice`, which sorts after red and amber and aggregates to the `notice` status only when nothing outranks it; an amber hydration alert still escalates a Notice-only Person to amber. `POST /api/symptom-events/[id]/answer` takes `{ outcome: "ongoing" }` (stores today's `ongoing_confirmed_on`, so it returns the next local day) or `{ outcome: "resolved", resolved_ymd? }` (sets `is_resolved`, a server-derived `resolved_at` and `end_date` at the start of that local day, never before the start day or after today). It needs write access to the Person and is audit-logged. The person action screen shows the prompt with a single Update button that opens Edit Symptom (the home list shows the text only, with no actions); saving a symptom that is still open through `PATCH /api/symptom-events` also stores today's `ongoing_confirmed_on`, so saving counts as the day's "still ongoing" answer. The Calendar draws the same span rules as lines: `GET /api/symptom-events?overlap=1` returns symptoms whose span touches the window, not only those starting inside it.
- **Person export:** Administration → Data Export & Restore (`/admin/export`, also in the header menu) lists every Person for an Admin, inactive ones labelled, via `GET /api/people?include_inactive=1` (other callers still receive active Persons only). That list adds `export_total_bytes` and `export_report_bytes` from [`estimatePersonExportBytes`](../lib/export/person-export-estimate.ts) (stored attachment sizes, a shared report file once, a missing file as nothing). The screen shows “about N MB, including M MB of reports”, a health-information warning, and a further warning when an export is above 100 MB because a proxy may reject the later upload. `GET /api/people/[id]/export/estimate` returns the same two byte counts for one Person and uses the same authorisation as the export. Profile → Account shows **Export my data** when the Account has a Personal-link (any Household Role, including None) and hides it otherwise; a None-role Account does not see this admin screen. The download is an in-page fetch ([`downloadPersonExport`](../lib/export/download-person-export.ts)): the browser reads the zip to the end, records the Person via `personExportStreamFinished`, then saves the file, so a later action can wait until the stream has actually finished. `GET /api/people/[id]/export` streams a standalone zip for one Person, active or inactive, in the format of [ADR-0028](adr/0028-export-format.md). An Admin may export anyone; any other Account only its own Personal-linked Person (`authorisePersonExport` in `lib/auth/auth-helpers.ts`, 404 otherwise). [`buildPersonExport`](../lib/person/person-export.ts) returns the entries in order: `manifest.json` (format version, scope, app version, export time, sections, counts, skipped files; types and the protected-export split in [`lib/export/export-manifest.ts`](../lib/export/export-manifest.ts)), `person.json` (the importer's source of truth, gathered by [`lib/person/person-export-payload.ts`](../lib/person/person-export-payload.ts): the Person; the medications they are assigned or have doses of, with frequency rules; assignments with schedules and dose expectations, exceptions and outcomes; slot outcomes (with their settle time); doses; observations with a bundle-local `group_id` for multi-field readings; test results with values; symptoms as stored; symptom–dose links; goals and expectations; observation-type and test-metric catalogues as name and `is_active`; and `user_settings` for the durable preferences held by that Person's Personal-link Account, keyed by the bundle-local Person id), readable copies `csv/administrations.csv`, `csv/observations.csv`, `csv/test_results.csv` (one row per value), `csv/symptoms.csv` (calendar dates in the instance timezone) and `csv/symptom_dose_links.csv` (formula-leading cells escaped), then `attachments/photo.<ext>` and `attachments/report-<n>.<ext>`. Cross-references use bundle-local ids; database ids appear only as `db_id`. A photo or report missing from storage is left out, listed in the manifest's `skipped_files`, and kept in `person.json` with `file: null`. `POST /api/people/[id]/export` with a generated passphrase streams the same zip encrypted with AES-256 ([ADR-0028](adr/0028-export-format.md)): the manifest stays readable and minimal (`protected: true`, no names, counts or dates of birth), a check entry rejects a wrong passphrase, and the section list, counts, records, CSV copies and attachments are encrypted under neutral entry names. The passphrase is shown once in the download dialog and is not stored. `GET` stays the unprotected download. The download dialog says an unprotected file is not encrypted and holds health information. [`streamExportZip`](../lib/export/export-zip-stream.ts) appends one entry at a time as the reader pulls (one attachment in memory) and stores already-compressed files uncompressed. A protected download uses [`streamProtectedExportZip`](../lib/export/protected-zip.ts) the same way. Each export writes an `EXPORT` / `people` audit row (scope, format version, counts) and one `person_export` line through [`logDataEvent`](../lib/data-event-log.ts) (persons, records and attachments, whether it was passphrase-protected, the actor's Household Role or `self`, and the outcome). A failure is that same line at error level. Neither the line nor a failure includes a name, email, date of birth, file name, health value or passphrase. The export holds a per-Person count in [`lib/export/export-registry.ts`](../lib/export/export-registry.ts) (`exportsInFlight`) until the stream ends, fails or is cancelled. A Household export uses the same helper with event `household_export` beside its audit row.
- **Data Export & Restore layout:** the page has two tabs, Export and Restore (`?tab=restore`; the setup Person step links straight to it). Both panels stay mounted so a half-finished restore survives a tab switch. Restore walks the preview as steps in [`RestoreFromExport`](../components/RestoreFromExport.tsx): choose the file, then People, Medications, Accounts and Review and apply. A step with nothing to show (no medications, Accounts not restored) is left out, a mapping with no target blocks Next, and the review step holds the warnings, differences, counts, confirmation and Apply. Catalogue entries missing from the instance are one grouped warning, not one banner each.
- **Household export:** `GET /api/export/household` (Admin only; anyone else 403, anonymous 401) streams one zip for the whole household, reusing [`buildPersonExport`](../lib/person/person-export.ts) and [`streamExportZip`](../lib/export/export-zip-stream.ts). `POST` with a generated passphrase encrypts that same archive, on the same terms as a Person export. [`buildHouseholdExport`](../lib/export/household-export.ts) writes `manifest.json` (scope `household`), `household.json`, then `people/<bundle id>/` for every Person in `sort_order`, id order, inactive included. Each folder is that Person's standalone export without its own manifest, so entry names never contain a name. `household.json` carries the full medication catalogue with groups, membership, frequency rules and active flags; Accounts as invite descriptors (email, role, `can_report`, `is_active`, `auth_method`, Personal-link as a bundle-local Person id) with no password, MFA secret, session or invite token; Favourites by bundle-local Account, Person and medication ids; registry settings that are neither `secret` nor `platformLocked`, resolved the same way the instance uses them; and the curated catalogue name-and-flag lists. The audit row is one `EXPORT` / `household` entry (scope, Person count, format version, counts, no health values) and the in-flight count covers every Person in the file. `GET /api/export/household/size` returns `{ bytes, reportBytes }` for the photos and reports that would be included. Data Export & Restore shows that estimate beside **Download household export**, the same health-information warning, and the same further warning above 100 MB. The same response writes one `household_export` line through [`logDataEvent`](../lib/data-event-log.ts) (persons, records and attachments, `protected`, the actor's Household Role, and the outcome). A failure is that line at error level and includes no personal data.
- **Restore:** Admin only, and refused while demo mode is armed. `POST /api/restore/upload` streams the zip to a temporary file (not `request.formData()`). A protected file (the readable manifest says `protected` and lists no sections) is held until `POST /api/restore/[id]/passphrase` opens it. A wrong passphrase is refused before any plan, and the same upload can be tried again. An unsupported cipher is refused at upload. Once the passphrase is accepted the staged file is rewritten without encryption, so the rest of restore reads it as any other export; the passphrase is not stored. That route is outside the auth proxy matcher so the proxy does not buffer the body; the handler calls `requireAdmin()` itself. The limit is `FC_RESTORE_MAX_UPLOAD_MB` (default 512). [`ZipFile`](../lib/restore/zip-file.ts) bounds every allocation and inflation by the real file size and per-entry caps (`manifest.json` 1 MB, `household.json` 16 MB, other entries the upload limit, inflated length must equal the declared size, zip64 rejected); see ADR-0026. A staged upload lasts 30 minutes (`openStaged` deletes it after that) and is removed after a successful apply. `GET /api/restore/[id]` is read-only: each Person is New, or Map to existing when the name and date of birth match exactly, with a warning when the name matches and the date does not; medications match by name ignoring case; frequency rules, schedules, goals and expectations that differ are listed and the instance's copy is kept. On a **household** export, Accounts are listed with a tick each (on by default except when the email already exists on the instance), notes when the target's sign-in method differs from the export, a Household Role selector for an Entra Account restored to a local-invite instance (the role is assigned by Entra groups and is not in the export; the choice travels as `role` on that Account's entry and is ignored for any other Account), and a pre-flight skip when outbound email is not configured (managed instances use Graph mail and always pass). An Entra Account whose object id is present on the file and whose hash is in `entra_removed_accounts` is not ticked; the preview says "removed on this instance; allow them back first". A removed local email is invited only when the Admin includes it, and `created_by` values that already hold the removal token are copied as stored. Favourites are written for Accounts this restore has just invited ([`lib/restore/restore-favourites.ts`](../lib/restore/restore-favourites.ts)), using the mapped Person and medication (or observation type). An Account already on the instance with the same email receives them additively (missing ones added, existing ones counted as duplicates, `added_to_existing` in the report; credential and role unchanged), and its per-user settings are filled only where unset. An Account that is neither invited nor on the instance does not receive them; a second run matches Account, Person, action and medication or type and adds nothing. Instance settings that are neither secret nor platform-locked are applied only when this instance has no stored value and the setting is not locked by the environment ([`lib/restore/restore-settings.ts`](../lib/restore/restore-settings.ts)); a value this instance already has is kept and listed in the preview. Secrets, platform-locked settings and sign-in (`auth.*`) settings are never written; a restore does not point an instance at an identity provider. Durable per-user preferences travel in `user_settings` from the format version that introduced that section ([ADR-0028](adr/0028-export-format.md)). A lower version has no section and restores nothing for them. Household restore writes them onto each pending Invite through [`writeUserSetting`](../lib/settings/user-settings-store.ts), keeping a key the Account already has, filling missing keys, and dropping a value that fails validation. Hydration pacing is written only when that Person was restored and the Personal-link Account was restored. A skipped Account's settings are skipped. The counts are part of the single `RESTORE` audit row. A Person export shows an optional Sign-in for this Person (`FormField`): no matching Account creates a pending Invite (Household Role None unless another is chosen) and sends it, or leaves it unsent when outbound email is not configured; an Entra instance still sends the invite (local and Entra sign-in both work, so the result says they can use either); a matching Account with no Personal-link is linked and the settings applied; an Account already linked to someone else is refused on that field; a blank field carries nothing and the result says so. Instance-settings restore still reports per-user keys as outside that step. A Person export leaves Favourites and instance settings as `"not restored"`. `POST /api/restore/[id]/apply` takes the confirmed choices and writes them in one transaction ([`applyStagedRestore`](../lib/restore/apply.ts)). Household Accounts are recreated as pending Invites through [`createInvite`](../lib/invite.ts) ([`lib/restore/restore-accounts.ts`](../lib/restore/restore-accounts.ts)): role, `can_report`, `is_active`, Personal-link via the Person mapping (None-role Accounts whose Person was skipped are skipped with a note; Accounts with a Household Role arrive unlinked). The role, `can_report` and Personal-link rules live in `inviteInputProblem` in `lib/invite.ts`; `createInvite` enforces them for every caller (the invite route and restore), and restore marks a failing exported row `skip_reason: "invalid"` in the preview with a note, so it is never created. Invite emails are sent after the database commit and file writes; a failed send leaves the pending Invite for Resend. No Account credential is read from or written to the export; an existing email is never overwritten. Records are append-only. An exact duplicate (dose: Person, medication, time, dosage and unit; observation: Person, type, time, value and reading group; test result: Person, name, date and ordered-by, matched to the event that shares values with the export when several share the key, with value differences reported and not applied; symptom: Person, label and start; links, assignments, goals, expectations and dose-expectation days by their existing keys) is skipped. Catalogue rows are created only for a Person who is restored. Observations and test values go through the normal value, unit and timestamp checks but do not require the type to be active; a type missing from the instance is skipped and listed; exported on/off flags are applied afterwards, and only for types that the restored Person uses. Photos and reports are written through the upload store after the commit, under new filenames. If a write fails, the files from that restore are deleted, the urls just saved are cleared, and the response names the bundle path that failed. One `RESTORE` audit row records scope, format version, source app version and counts, plus the usual per-row create rows, with no measurement or dose values in the details. Apply also writes one `restore_applied` line (persons, records and attachments, `protected`, the actor's Household Role, and `applied` or `failed`). A database error rolls the transaction back and writes no files. The Data Export & Restore screen calls these routes: a shared file field (`.zip`, with the upload limit in the hint) posts the file as the request body, then shows the preview. Each Person is a labelled radio group (New, Map to existing, Skip) with the name and date of birth side by side through the shared date formatter, a warning when a mapped date of birth differs, and an existing-Person select. Medications are New or Map to existing. Configuration differences, counts and warnings are shown, and Apply stays unavailable until the preview is confirmed. The result names what was created, skipped or not restored, including Favourites, settings that were applied or kept, and per-user settings. The preview lists each settings difference (this instance's value and the export's). Below 1024px, the same width as Import Records, restore is replaced by the Desktop Required screen; downloads on the page stay available. Errors are announced and focus moves to the first problem.
- **Soft deletes:** `is_active` flag on people, medications, and observation type catalogue rows. Routine deletes hide a row and keep it. Person erase is the exception: a hard delete of one Person, described below.
- **Person erase:** `GET /api/people/[id]/erase` returns the confirmation counts (doses, observations, test results with reports and photos) and the notice that backups may still contain the Person. It does not delete anything. An Admin may read it for any Person; a Personal-link may read it only for their own. Data Export & Restore shows **Reactivate** (Manager and above, `POST /api/people/[id]/reactivate`, audited as an update) and **Erase** (Admin only) on each inactive Person. Erase opens `/admin/export/[id]/erase`: the counts, **Download export first** (not required), the backup notice, and the Person's name typed into a field whose error is announced. Erase stays disabled, and says why, until the name matches and any download started on the page has finished. Profile → Account offers the same confirmation to an Account with a Personal-link, after a local password (and authenticator code when one is enrolled). When a linked Account is present, the confirmation offers **Also permanently remove their Account** (on for Household Role None, off for an Account with a role, disabled with the last-local-Admin reason when that guard applies). The result says the account was removed, that it stays unless an administrator removes it, or that a None-role account has been deactivated and the person is signed out. `POST /api/people/[id]/erase` permanently removes one Person. The body may include `remove_account: true`; that runs Account removal as the last step of the same transaction, and only when the last-local-Admin check allows it. Omitting the flag leaves the previous outcome. When an Admin's erase would also remove the Admin's own Account (the Person is Personal-linked to it), the same fresh proof as the self branch is required first, so a hijacked session cannot delete it; the preview's `account.is_own` makes the confirmation screen ask for the password (and authenticator code), and the own-Account test is `isOwnAccount` in `lib/account/own-account.ts`, shared with the Account removal route. An Admin may erase a deactivated Person. Any other Account may erase only its own Personal-linked Person, including one that is still active, after a fresh sign-in: a local Account confirms its password (and authenticator code when enrolled); an Entra Account needs an interactive sign-in within the last five minutes. Anyone else gets 404. The demo refuses every erase. Erase is refused while [`exportsInFlight`](../lib/export/export-registry.ts) shows a download of that Person. [`erasePerson`](../lib/person/person-erase.ts) then, in one transaction, deletes doses, observations, test results and values, symptoms and links, assignments, schedules, goals, expectations, dose expectations with exceptions and outcomes, slot outcomes, Favourites, notification preferences, notification history and the push dedupe rows for those records, blanks `audit_log.details` on every row about that Person or those records (actor, action, table and time stay), and writes one `ERASE` / `people` row whose details are `{ event: "Person erased", counts }` with no name or date of birth. The photo and report files are deleted after the commit; a file that cannot be deleted is logged and listed in `file_failures`, and the database erase stands. The response is built before any Account change. A linked None-role Account is then deactivated and its `session_version` bumped, so the next request is signed out; if that update fails the erase result is still returned. An Account with a Household Role is left able to sign in, and the result says so (`account_outcome: "kept"`). Erase does not touch operator backups: restoring an older backup can bring the Person back. One `person_erased` log line records the actor's Household Role or `self`, the counts (including persons, records and attachments), how many files failed, and the Account outcome, and not the Person's name, date of birth or record text. A failure is that line at error level. Account removal uses the same helper with event `account_removed` beside its audit row. See [ADR-0025](adr/0025-person-erase.md).
- **Audit log:** Every write (create/update/delete) is recorded in the `audit_log` table via `auditLog()` in `lib/audit-log.ts`. Settings writes use `upsertAppSetting` (`app_settings`) and `writeUserSetting` (`user_settings`, user-initiated only — hydration bookkeeping keys skip audit). Details JSON must **not** duplicate health-record values (observation measurements, medication doses, or record comments) — see [ADR-0008](adr/0008-audit-log-coverage.md) for the full auth/security inventory and allowed metadata shape. Admins browse the trail at `/admin/audit-log` (`GET /api/admin/audit-log`, filterable). Security/admin entity types also mirror a structured `logger.audit` line to stdout for the Admin container log stream. Export, restore and erase add a separate data-free line via [`lib/data-event-log.ts`](../lib/data-event-log.ts). The event names are `person_export`, `household_export`, `restore_applied`, `person_erased` and `account_removed`. Each line carries counts (persons, records, attachments), whether an export was protected, the actor's Household Role or `self`, and the outcome. Person export, Household export, restore apply and Person erase emit that line beside the audit row. The audit row itself is unchanged.
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
| `medication_records` | Dose history (person, med, `recorded_at`, dosage, `created_by`, `administered_by` — who gave the dose: NULL/`me` \| `another_caregiver` \| `away_from_home`) |
| `observations` | Health measurements (`session_id`, `value_label` for multi-field types such as blood pressure) |
| `person_observation_expectations` | Recurring observation schedules (cadence, interval, recurrence config) |
| `observation_type_config` | Curated observation catalogue rows (seeded); tenant toggles `is_active` only — metadata is not manager-editable (see ADR-0012) |
| `symptom_dose_links` | Opt-in descriptive many-to-many link between a symptom (`symptom_event_id`) and a dose (`medication_record_id`), with `person_id`, `created_by`, `created_at`; both foreign keys `ON DELETE CASCADE`, same-Person enforced in the write path ([`lib/symptoms/symptom-dose-links.ts`](../lib/symptoms/symptom-dose-links.ts)). Created via `linked_record_ids` on `POST /api/symptom-events`, `linked_symptom_ids` on `POST /api/records`, or `PUT /api/symptom-dose-links` (add/remove from either side; write access to the Person; `LINK`/`UNLINK` audit rows on both records). `GET /api/symptom-dose-links` returns a Person's links, one record's links, or candidates (a dose's local day inside the symptom's span, using the client timezone headers). Does not affect the open-symptom prompt, Notice state or dashboard colours; included in the person export (`person.json`, `csv/symptom_dose_links.csv`) |
| `test_metric_config` | Curated test-metric catalogue rows (metric name, default SI unit, JSON `aliases`, `panel` label, `value_type`), shipped in [`lib/test-results/test-metric-catalogue.ts`](../lib/test-results/test-metric-catalogue.ts) and refreshed by migration `023_test_metric_catalogue` (managers toggle `is_active` only); mirrors `observation_type_config` — no reference-range/flag columns, those are transcribed per test event, never pre-populated. See [ADR-0019](adr/0019-test-metric-catalogue.md) |
| `test_events` | Test result header (person, name, `date` = the test date stored at local midday, `ordered_by`, notes, `attachment_url` — the report itself is the source of truth; a write must be a canonical `/api/test-results/uploads/<uuid>.<ext>` URL not already used by another Person's event, and cleanup and export name a blob only through `parseTestAttachmentUrl` in `lib/test-results/attachment-url.ts`, so legacy non-canonical rows are tolerated but never delete or export a file). `test_type` is retained but no longer asked for: absent is stored as `''` and History shows the sub-label only when set |
| `test_result_values` | Curated structured values per test event (`test_event_id` FK `ON DELETE CASCADE`), `value_type` numeric/qualitative gated by a `CHECK` constraint against `numeric_value`/`qualitative_value`; `reference_range`/`flag` are free-text, transcribed from the report in hand; nullable `limit_qualifier` (`<`, `<=`, `>`, `>=`) sits beside the number so "< 20" is 20 with `<` |
| `symptom_events` | Standalone symptom record (person, free-text `label`, `start_date`, nullable `end_date`, `severity` 1–5 gated by a `CHECK` constraint, `is_resolved`/`resolved_at` pair for the resolved/active state, nullable free-text `notes`, nullable `ongoing_confirmed_on` local day of the last "still ongoing" answer) |
| `push_endpoints` | Web Push subscription keys per user/device (`web_push_auth`, `p256dh`, …) |
| `person_notification_prefs` | Per-person, per-user notification toggles |
| `accounts` | Canonical accounts, local or Entra (`role`, `can_report`, `is_active`, `auth_method`, invite fields, TOTP secret for MFA, `must_reset_password` for the managed admin forced first-login flow, …). Permanent removal deletes the row and rewrites that email to a `removed:` token in `audit_log.user_email` and every `created_by` column ([ADR-0027](adr/0027-account-removal.md)) |
| `entra_removed_accounts` | SHA-256 hash of an Entra object id whose Account was removed, plus `removed_at`. No email or name. Sign-in checks it before creating an Account. "Allow this person back" deletes the row |
| `system_config` | Key/value settings (`setup_complete` = `1` after first-run wizard; `admin_seen` = `1` once an admin has authenticated — closes the bootstrap window on Entra-primary instances) |
| `audit_log` | Full write audit trail |
| `prn_push_requests` | Triggers a PRN (as-needed) dose reminder push when a dose is recorded |
| `push_log` | Deduplication log for cron-sent push notifications (keyed by `ref_key`) |
| `notification_log` | Per-recipient history of sent pushes (`recipient_user_id`, `person_id`, type, title, body, `sent_at`) — written at send time via `sendAndLogPush` |
| `dose_expectations` | A dose routinely given away from home ([ADR-0017](adr/0017-dose-expectations.md)): `person_medication_id` + `slot_hhmm`, a parent-entered `start_date`/`end_date` term, optional `weekdays` JSON (0 = Sunday). Several rows per slot model several terms; `ON DELETE CASCADE` from `person_medications` |
| `dose_expectation_exceptions` | One-off skip days (`local_ymd`) for an expectation |
| `dose_expectation_outcomes` | The parent's answer per expectation-day: `confirmed_given` (links the created `medication_record_id`), `confirmed_missed` (history only; listed in the History feed by `GET /api/dose-missed`), or `snoozed` (`snoozed_until`); `slot_at` is the dose time answered (NULL on older rows, which fall back to `resolved_at`). Pending itself is derived, never stored |
| `slot_outcomes` | What happened to each Scheduled slot, keyed by `(person_medication_id, local_ymd, slot_hhmm)` with `local_ymd` on the Schedule clock. `result` is `on_time`, `early`, `late`, `missed` or `given` (a dose expectation answered Given: attached, no timing label); `offset_minutes` is slot-to-dose (negative = early; NULL for missed and given); `missed_cause` is `timed_out`, `not_given` or `early_answer`; `medication_record_id` is the attached dose (NULL for missed; deleting the dose deletes the row, reopening the slot). A row exists only once a dose attaches or the slot is Missed, so labels survive schedule edits. Written by `lib/schedule/slot-outcomes.ts`: `recordDose` calls `classifyAndAttachDose` (a dose within 10 minutes either side of a slot, `ON_TIME_WINDOW_MS`, attaches as On time; otherwise the result comes back as `timing: { kind: "needs_prompt", previousSlot, nextSlot, earlierOpenSlots }` and nothing is stored; `POST /api/records` returns it, and the record screen shows an inline warning Banner with Late / Early / Extra dose buttons while the dose stays saved; an unanswered prompt leaves it an extra dose), `answerDoseTiming` applies Late / Early / Extra (Early marks earlier open slots Missed at once; reached by `POST /api/records/[id]/timing` with `{ answer }`, which needs write access to the Person and answers 409 once the dose is attached), and `settleSlots` marks a slot Missed when the next slot starts or its Calendar day ends (called from `recordDose` and cron; skips slots under a dose expectation and slots from before migration `030_slot_outcomes`). Unscheduled medications are never classified. Missed raises no alert and never blocks a dose (ADR-0011). The decisions and interim limits are in [ADR-0029](adr/0029-dose-timing-and-missed.md). The old `schedule_reminder_suppressions` table ("cancel the next slot") is gone (migration `032_drop_schedule_reminder_suppressions`). Separate from `dose_expectation_outcomes`. Travels in the Person and household exports as the `slot_outcomes` section (bundle-local assignment and dose ids, [ADR-0028](adr/0028-export-format.md)); restore maps each row onto the restored assignment and dose, counts one already there as a duplicate and never overwrites it; Person erase deletes the rows explicitly by assignment (indexed) and counts them as `slot_outcomes` |

### Key helper functions

SQLite boot (`lib/db.ts`) is a small, deep interface — open the singleton, apply the baseline schema, run migrations. It does not own domain queries; those live with the modules that already own each concept:

- `getDb()` (`lib/db.ts`) — singleton DB connection
- `auditLog(db, email, action, entityType, entityId, details)` (`lib/audit-log.ts`) — log a write
- `isSetupComplete(db)` / `setSetupComplete(db, email)` (`lib/setup-gate.ts`) — first-run wizard gate (`system_config.setup_complete`); the proxy reads this sentinel directly; `GET /api/setup/status` still returns the full wizard context for `/setup`
- `isAdminSeen(db)` / `markAdminSeen(db)` (`lib/setup-gate.ts`) — admin-seen sentinel (`system_config.admin_seen`); set on first admin-group Entra sign-in to close the unauthenticated bootstrap window
- `getObservationGoal(db, personId, observationType)` / `setObservationGoal(...)` / `deleteObservationGoal(db, personId, observationType)` (`lib/observation/observation-goals.ts`) — per-person observation-goal CRUD
- `goalTypesFor(observationType)` / `isGoalEligible(observationType, goalType?)` (`lib/observation/goal-eligibility.ts`) — the one list of which observation types take which goals (Hydration daily minimum; Weight range and trend; range for Temperature, Blood Pressure, Heart Rate, SpO2, Blood Glucose, Respirations). Height and Head Circumference take none: `POST /api/observation-goals` rejects them and `GET` omits any saved row, which stays in the database, export and restore
- `getTodayHydrationTotal(db, personId, startUtcIso, endUtcIso)` (`lib/hydration/hydration-evaluate.ts`) — today's hydration ml total, unit-converted
- `getLatestPersonWeightKg(db, personId)` (`lib/frequency-rule.ts`) — most recent weight (handles lb→kg)
- `getApplicableFrequencyRule(db, medicationId, ageYears, weightKg)` (`lib/frequency-rule.ts`) — picks the best-matching **medication-scoped** rule by age/weight band; group-scoped rules are not evaluated

### Person age (`lib/person/person-age.ts`)

Two named operations — do not collapse them:

- `fractionalAgeYears(dob, timeZone, asOf?)` — continuous age (elapsed ms ÷ 365.25 days) for catalogue / `min_age_years` / `max_age_years` gates (medications, frequency rules, observation type max age). Empty or unparseable DOB → `NaN`.
- `completedCalendarYears(dob, timeZone, asOf?)` — whole birthday-based years for display (people management) and under-18 weight UX on record-medication. **Intentional:** under-18 uses calendar years, not fractional. Leap-day DOBs (`29 Feb`) tick the new age on **1 March** in non-leap years (AU/UK convention). Empty or unparseable DOB → `NaN`.

**Timezone (birthday boundaries):** Both ops take a required IANA `timeZone`. Callers pass the instance locale clock — server via `resolveAgeTimezone(db)` (`resolveInstanceTimezone(db) ?? "UTC"` in `lib/instance-timezone.ts`); client via `instanceTimezone` on `GET /api/me` (same effective value). Empty/invalid `timeZone` arguments are treated as `UTC`. DOB is midnight in that zone; calendar “today” is the wall date of `asOf` (or now) in that zone. Age is **not** per-user hydration TZ or the caregiver’s browser TZ. Client age UX waits until `instanceTimezone` is known before computing age-dependent UI.

Schedules / calendar context may still fall through to client offset headers when no IANA is set; age does not — it uses instance tz or UTC so server gates and client UX stay aligned.
---

## Authentication and permissions

**Providers:** Two auth providers are supported simultaneously via NextAuth 5 beta:

1. **Microsoft Entra ID (OIDC)** — sign in with an Azure AD account; group membership is read from the token's `groups` claim and matched against `ENTRA_GROUP_*` env vars.
2. **Local credentials** — email + bcrypt password verified against the `accounts` table; accounts invited via `/admin/accounts`. The **first-run wizard** at `/setup` creates the initial local admin when no local admin exists and `setup_complete` is not set; afterwards new local accounts are invited by email (invitee sets their own password). Local accounts receive `local:` prefixed group strings. App lock: `POST /api/me/app-lock/reauth-grant` (fresh password+TOTP, or a recent Entra `entraAuthAt`, required before the device opt-out is written, before the lock screen's reset of a broken credential clears it, and before first set-up on a device unless the Account password-signed-in within the same five minutes: `{recentSignIn: true}` is checked against the session's `localAuthAt`, stamped only on the `credentials` sign-in in the jwt callback) and `POST /api/me/app-lock/failure-log` (authenticated, per-Account rate-limited ceremony failure reports; no credential data) — ADR-0016. Login and step-up re-auth (`POST /api/me/password`, `/api/me/mfa/{setup,confirm,disable}`) share `lib/auth/auth-rate-limit.ts` lockout; failed re-auth attempts are `auditLog`'d (`AUTH_FAILURE`). Wizard MFA confirm bumps `session_version` (revoking the pre-enroll JWT) and then re-issues a session with email + password + the just-verified TOTP; password-only `signIn` fails once `totp_secret` is set. If stage 1 is already complete and there is no session, the wizard shows sign-in rather than person/timezone (those APIs use `requireAdmin()`).

Both providers can be active at the same time. Local credentials are always available. Entra sign-in is on when `auth.entra.enabled` resolves true — `FC_AUTH_ENTRA_ENABLED`, or the database row when that variable is unset (default off) — and credentials resolve from env or System Settings.

**Invite-based accounts** ([ADR-0015](adr/0015-accounts-unification.md)): sending an invite inserts an `accounts` row at `status=invited` immediately (email, role, optional Person link via `people.account_uid`). The emailed token is opaque 32-byte base64url; `sha256(token)` is stored in `invite_token_hash` (plain DB lookup, **not** HMAC — unlike managed-admin reset tokens in [ADR-0014](adr/0014-managed-admin-forced-reset-first-login.md)). Expiry is a fixed 7 days; resend re-issues the token, revoke sets `invite_revoked_at` without deleting the row or clearing the Person link. Local invitees redeem at `/accept-invite` (`POST /api/accounts/invites/accept`). Entra first sign-in matches a live-or-dead pending invite by normalised email (`lib/invite.ts`'s `claimInviteForEntra`, tried first by the `lib/account/account-entra-match.ts` orchestrator) or auto-creates an `accounts` row (`auth_method=entra`, `external_id` = oid) as a link anchor — Entra roles still come only from group membership. Dead invites (expired or revoked) are excluded from the people-management Linked Account dropdown. Invites require outbound email (`isOutboundEmailConfigured()`). `accounts.role` is hidden in admin UI for `auth_method=entra`. `accounts.is_active` gates sign-in for local accounts only (it is read on the local sign-in, re-auth and session-refresh paths); for Entra accounts access comes from group membership and revalidation ([ADR-0009](adr/0009-entra-live-revocation.md)), so `PUT /api/accounts/[id]` returns 400 for `is_active` on an Entra account and the Accounts screen shows no Disabled chip or sign-in switch for one. `accountStatus()` in `lib/account/invite-status.ts` is the one derivation of a row's invite state (Revoke and Resend) and combined chip (Disabled > Revoked > Expired > Invited > Active). Permanent removal is `POST /api/accounts/[id]/remove` (Admin, typed email, not their own Account) and `POST /api/me/remove-account` (the holder, after a fresh sign-in). Both call `removeAccount` in `lib/account/remove-account.ts`. The last-local-Admin refusal is `isLastLocalAdmin` in `lib/account/last-local-admin.ts`, shared with `PUT /api/accounts/[id]`. A removed Entra object id is a row in `entra_removed_accounts`; `signInEntraAccount` checks it before `matchOrCreateEntraAccount`, Auth.js sends that sign-in to `/account-removed`, and `POST /api/admin/entra-removed` clears one hash. Screens show a `removed:` token as "Removed account" via `displayAccountActor`. See [ADR-0027](adr/0027-account-removal.md).

**Outbound email:** Managed profile uses Microsoft Graph only. Self-host SMTP (`email.smtp.*`) rejects cloud-metadata / link-local host literals; transport failures return a generic client error (no banner echo). `POST /api/app-settings/test-email` is rate-limited and audited. On managed instances, System Settings shows a read-only "Outbound email — Managed via environment" card with configured status and the test-email button; SMTP registry keys remain omitted (`platformLocked`).

**Role ladder** (each level includes the previous): `readonly` → `readwrite` → **`manager`** → `admin`. Local Role **None** (`accounts.role = 'none'`, in `VALID_ROLES`) is not a rung: `getUserRole` returns `null`, and `localRoleToGroups` adds no ladder group and no `local:report`. A Personal-link still admits the shell (`hasAnyReadablePerson` / `requireRead`). [ADR-0022](adr/0022-none-household-role.md). No new environment variable.

**Household Reports** (`canReport`) is separate from that ladder: family and other-Person reports. **Only the permission plumbing ships:** `canReport`, `authoriseReportSubject` and the `householdReports` flag on `/api/me` exist, but there are no report generate routes and no `report_schedules` table in this release. It requires a household Role on local Accounts (`can_report`); Role None clears the flag. **Self-report** does not use `canReport`. The seam for future generate routes is `authoriseReportSubject(db, ctx, personId)`: allow when `canReport(groups)` and the session may read that Person, or when the subject is the session's Personal-linked Person (`findPersonalLinkPerson`).

| Role | Entra group env var | Local group string | Capabilities |
|------|--------------------|--------------------|-------------|
| `readonly` | `ENTRA_GROUP_READONLY` | `local:read` | View people, records, observations |
| `readwrite` | `ENTRA_GROUP_READWRITE` | `local:write` | All readonly + record doses/observations for permitted people, and add a bare medication (name, default dosage, unit) when recording a dose (`POST /api/medications`) |
| **`manager`** | **`ENTRA_GROUP_MANAGER`** | **`local:manage`** | All readwrite + **Management** (`/management`): people, curating the medication catalogue (groups, frequency rules, active flags), observation type catalogue (active/inactive), spreadsheet import (`canManage`) |
| `admin` | `ENTRA_GROUP_ADMIN` | `local:admin` | All manager + **Administration** (`/admin`: overview, accounts, etc.; `isAdmin`) |
| None | — | (none) | Personal-link only (including adding a bare medication while recording for that Person), plus Self-report of that Person. `getUserRole` is `null` |
| Household Reports | `ENTRA_GROUP_REPORTS` | `local:report` (+ admin) | Family and other-Person reports (`canReport`; permission only, no report routes or schedules ship yet); orthogonal to the ladder |

**Personal access:** An Entra user whose session `id` or linked OID matches `people.account_uid` can read/write their own record when they would otherwise lack global `canRead` / `canWrite`. Use [`sessionAccountUids()`](../lib/account-identity.ts) when matching. Local accounts use `id = local:<db_id>`; the same linking applies if `people.account_uid` is set accordingly (optional linking). App shells and `requireRead()` admit sessions with global read **or** at least one active Personal-link match (`hasAnyReadablePerson`); users with neither still hit `/denied?reason=no-group`.

**Account identity (`lib/account/account-identity.ts`):** The single home for "is this Account this Person's Personal-link, or only a Watcher?" Rows in `person_notification_prefs` are **Watcher** links (caregivers following a person), not aliases of `people.account_uid` — `watchedPersonIds(db, uid)` lists the person ids a uid follows this way, and `isWatcherOfPerson(db, uid, personId)` checks a specific one (a prefs row *without* that person's Personal-link — push auto-subscribe also plants a prefs row for the Personal-link account itself, so a prefs row alone doesn't mean Watcher). `findPersonalLinkPerson(db, session)` returns the session's Personal-linked Person by `people.account_uid` match only — no fallback to `person_notification_prefs` — so a mere Watcher is never treated as linked (`findLinkedPerson`'s old prefs-fallback let exactly that happen and was deleted). Hydration/push identity is resolved per request via `resolveHydrationSettingsUid()` / `findPersonalLinkPerson()`. The hydration settings merge and bucket selection (`hydrationSettingsCandidateUids()`, `resolveHydrationSettingsUid()`) admit **only** a person's own Personal-link account — `isPersonalLinkUid(db, uid, personId)` checks `people.account_uid` — so a mere Watcher can never read or write the person's shared hydration pacing/mute (a read-only caregiver could otherwise suppress the shared reminder; the legacy push-account fallback was retired). When a session is present, `hydrationSettingsCandidateUids()` returns only the caller's own uids unless they are that Personal-link, so a prefs-only / demoted Watcher cannot `GET /api/me/hydration-config` or timezone and still merge `people.account_uid` settings. Cron (no session) continues to read the shared person bucket. Push `POST /api/push/subscribe` only auto-inserts a `person_notification_prefs` row via `findPersonalLinkPerson()` — a Watcher-only session's own registration never plants an unrelated auto-subscribe row. The boot-time `migrateAccountIdentity()` reconciliation (which promoted legacy `people.user_uid` from notification-pref uids) was **retired in 0.39.2**: inferring ownership from a Watcher pref allowed a planted Watcher to be promoted to owner. Ownership is now only ever set through explicit person management — never inferred. Setting, moving or clearing a Personal-link through `POST /api/people` or `PUT /api/people/[id]` is Admin only (a Manager gets 403 `Unauthorised: only an Admin can change a Person's linked account`); a Manager's edit that leaves `account_uid` unchanged still succeeds, and invite acceptance and Account creation set links through their own routes. Otherwise a Manager could link any Person to their own Account and so export or hard-erase it as its owner ([ADR-0025](adr/0025-person-erase.md)).

**Dose-write validation (`lib/medication/medication-record-validation.ts`):** `validateMedicationRecordWrite(db, input, options)` is the single seam for `POST`/`PATCH /api/records` and spreadsheet import. It bounds `recorded_at`/`dosage`, rejects a `dosage_unit` that does not match the catalogue unit case-insensitively (a divergent unit would escape the unit-scoped 24h rolling total), and — when `person_id` is supplied — requires an active `person_medications` link (unless `requirePersonLink: false`) and enforces the medication's age bounds against the person's date of birth. Global catalogue creation via `POST /api/import/confirm` is gated on the global `canWrite` role; a personal-link / read-only writer may import only against existing medications, and a row failing validation leaves no orphan catalogue entry. **Catalogue creation:** `POST /api/medications` creates a bare row (name, default dosage, unit) for a global `canWrite` caller, or for a caller who can write the Person named by `person_id` (a Personal-link Account of any Household Role, the same check as writing to its own Person); anything else gets 403 "Ask a Manager or Administrator to add this medication." and learns nothing about an existing row. The audit entry records the Person. Frequency rules, groups, active flags, `create-variant` and the spreadsheet import stay Manager. **PRN cooldown and 24h quantity/count caps are not write gates** — they drive dashboard alerts and reminders only ([ADR-0011](adr/0011-prn-rules-are-alerts-not-write-gates.md)).

**Observation-write timestamps:** `POST`/`PATCH /api/observations`, `PUT /api/observations/[id]`, and spreadsheet observation/BP import call the same `validateRecordTiming` helper so a future or implausibly old `recorded_at` cannot become “latest” and suppress overdue observation (or weight-banded PRN) reminders. Type and value checks remain in `validateObservationWrite`.

**Variable naming:** Use **`sessionUserId`** (or similar) for `session.user?.id` when passing into `canReadForPerson` / `canWriteForPerson` — it is not Entra-specific.

**Permission helpers** (`lib/permissions.ts`):
- `canRead(groups)`, `canWrite(groups)`, **`canManage(groups)`**, `isAdmin(groups)`, `canReport(groups)` — `canReport` is Household Reports only
- `getUserRole(groups)` → `readonly` \| `readwrite` \| `manager` \| `admin` \| `null` (`null` for Role None and for unmapped groups)
- `authoriseReportSubject(db, ctx, personId)` in `lib/auth/auth-helpers.ts` — seam for future report generate routes (Household Reports or Self-report); no such route ships yet
- `canReadForPerson(groups, sessionUser, personUid)`, `canWriteForPerson(groups, sessionUser, personUid)` — both call `sessionAccountUids()` from `lib/account/account-identity.ts`
- `hasAnyReadablePerson(peopleUserUids, groups, sessionUser)` — app-level read gate for demoted Personal-link sessions

**UI / layout enforcement:**
- **`app/(writable)/layout.tsx`** redirects to `/denied` if `!canManage(...)`. **`/management/*`** and writable **`/admin/*`** routes live here.
- **App menu** (`AppHeader`) shows Management only for `/api/me` role `manager` or `admin`.

**Enforcement pattern:**
- **Pages:** `const session = await auth()` → redirect to `/denied` or `/login` if insufficient role
- **API routes:** Return `401 Unauthorised` / `403 Forbidden` on auth failure (British spelling for JSON `error` strings is intentional)

**Session revocation (`lib/auth.ts` `jwt` callback):** Two revocation signals are evaluated per request. Local accounts are re-derived against `accounts` via `refreshLocalUserSession` (rejects on `is_active = 0` or a `session_version` bump from a password/MFA/role change). Entra sessions are checked against `auth_revalidation_status` (`lib/auth/auth-revalidation.ts`, `getAuthRevalidationStatus` / `evaluateEntraSessionValidity`) — a generic `(provider, external_id)` table, hourly-refreshed by a background Graph poll piggybacked on `lib/cron.ts`'s dispatcher (app-only token via `lib/entra-graph-token.ts`), plus an admin-triggered instant revoke with no Graph dependency (`POST /api/admin/entra-sessions/[oid]/revoke`). After a successful poll, JWT `groups` soft-refresh from non-null `groups_json` without forcing re-login; pre-poll null `groups_json` leaves login-time claims alone. Revoke also prunes Web Push subscriptions. Push delivery fails open for an Entra `ok` row with null `groups_json`; `getEntraRevalidationGap()` (`lib/auth/entra-revalidation-gap.ts`) derives when that is going unnoticed (Graph not configured, or a user stuck without group data for ~2h), driving the Warning banner on `/admin/entra-sessions` and `/admin/overview` (`components/EntraRevalidationGapBanner.tsx`), the once-per-process poll log, a weekly Admin push (`lib/push/entra-revalidation-gap-push.ts`, `push_log` key per ISO week, no notification-history row), and an email fallback for Admins with no push subscription (`lib/push/entra-revalidation-gap-email.ts`, sent only when outbound email is configured; one `app_settings` row `entra.revalidation_gap.emailed_week` holds the ISO week last emailed and is removed when the gap clears; the Entra Sessions banner notes when email alerts are off). `ENTRA_SESSION_MAX_AGE_MINUTES` (default 480 = 8h) is the fail-safe bound — max time since the last successful revalidation (or sign-in, if never yet revalidated) — not an unconditional forced-relogin timer. See [ADR-0009](adr/0009-entra-live-revocation.md), which supersedes the earlier absolute-lifetime-only mechanism. On any revocation signal the callback **returns `null`**, which makes Auth.js clear the session cookie (`sessionStore.clean()`) and resolve `auth()` / `req.auth` to `null` — so the standard `redirect("/login")` guards fire and the user lands on the login page (a near-silent SSO bounce for Entra), **not** the `/denied?reason=no-group` screen. `/denied` is reserved for genuinely authenticated users who hold no FamilyChart group. Distinguish the two: revoked/expired → `/login`; authenticated-but-ungrouped → `/denied`.

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

**Client components** (`"use client"`): Only for interactive pages (forms, charts, tabs). These call `/api/*` endpoints via `fetch` — no direct DB access. Person History (`app/[personId]/history/page.tsx`) keeps tab routing, edit-draft inputs, and confirm dialogs; medication and observation fetch/keyset/save/delete live in `lib/medication/medication-history.ts` and `lib/observation/observation-history.ts`. The Date tab merge stays on the page (deferred to the History display rework).

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

Brand colours are defined as CSS variables in `app/globals.css` (`@theme`, so Tailwind generates utilities for them):

```css
--color-fc-blue: #256AA5       /* fc-blue, fc-blue-mid #1A5F96, fc-blue-dark #124F7A stay as the three brand colours */
--color-fc-header: #C8DDEF
--color-fc-panel: #D8E9F5
--color-fc-ring: #88B8D8
```

Custom classes use the `fc-` prefix (e.g., `fc-blue`, `fc-panel`, `fc-scroll`).

**Surfaces:** `.fc-surface-app` is the standard scrollable blue canvas for **home**, **person** flows, and **management** tool pages. `.fc-surface-admin` is the darker canvas for **`/admin/*`**. The Management and Administration hubs use the shared `HubTile` (see UI components).

### UI components

This section is the single source of truth for the shared UI definitions and grows with each slice of the UI consistency work. Vocabulary (**Area**, **Canvas**, **Card**, **Banner**) is in [`CONTEXT.md`](../CONTEXT.md). Text needs 4.5:1 contrast and non-text 3:1 (WCAG 2.2 AA).

#### Colour tokens

Declared in `@theme` in `app/globals.css`, named as the 1.2.0 theming work expects (these values are its Classic mapping). `lib/__tests__/ui-contrast.test.ts` reads them from the CSS and asserts every decided text and background pair.

| Token | Value | Use |
|---|---|---|
| `surface-app` | `#256AA5` | User and management Canvas (management is told apart by structure, not colour) |
| `surface-admin` | `#124F7A` | Admin Canvas |
| `surface-header` | `#C8DDEF` | Header and footer bar |
| `surface-panel` | `#D8E9F5` | Banners, forms, modals |
| `surface-action` | `#1A5F96` | Solid Cards on every dark Canvas, no transparency |
| `text-primary` | `#1e2939` | Body text on light surfaces |
| `text-secondary` | `#4a5565` | Hints and secondary text on light surfaces |
| `text-brand` | `#256AA5` | Brand text on panel or white; never on the header bar (4.08:1) |
| `text-on-brand` | `#FFFFFF` | Text on any dark surface |
| `text-on-brand-muted` | `#e0ecf6` | Secondary text on any dark surface |
| `status-error-text-on-brand` | `#ffc9c9` | Error text on Cards and the admin Canvas only (3.92:1 on the app Canvas: use a light Banner there) |
| `status-error-text` | `#b91c1c` | Error text on light surfaces |
| `status-success-text` | `#166534` | Success text on light surfaces |
| `status-warning-text` | `#92400e` | Warning text on light surfaces |
| `badge-{warning,success,neutral,info,error}-{bg,fg}` | see `globals.css` | Self-contained pills: solid fill, dark text, never transparent |
| `focus-ring` / `focus-ring-on-brand` | `#256AA5` / `#FFFFFF` | 2px minimum focus ring on light / dark |
| `disabled-bg`, `disabled-fg`, `disabled-fg-on-brand` | `#cfdbe6`, `#4a5565`, `#e0ecf6` | Disabled: light surfaces get the fill; dark surfaces get no fill and a 1px dashed border. The reason is always shown as text |

Translucent `text-white/NN` and `bg-white/NN` patterns must not carry text or form a Card. The fixed privacy cover in `globals.css` is a deliberate exception (white on `#1a5f96`, 6.73:1, included in the contrast table).

#### Surface

[`components/ui/Surface.tsx`](../components/ui/Surface.tsx) declares a region `dark` or `light` with a `data-surface` attribute. `globals.css` turns that into `--fc-surface-*` custom properties (foreground, muted foreground, brand, error, focus ring, disabled fill, text and border), so shared controls follow the surface through CSS and take no tone prop. A region with no declaration is light. `.fc-surface-app` and `.fc-surface-admin` are dark.

#### Buttons

[`components/ui/Button.tsx`](../components/ui/Button.tsx), [`IconButton.tsx`](../components/ui/IconButton.tsx) and [`EntityRowActions.tsx`](../components/ui/EntityRowActions.tsx). Colours come from the `--fc-*` custom properties of the nearest `Surface`, so there is no tone prop; the classes are in `globals.css` (`.fc-btn*`).

| Variant | Dark surface | Light surface |
|---|---|---|
| `primary` | white fill, `#256AA5` text | `#256AA5` fill, white text |
| `secondary` | 2px white outline, white text | 2px `#256AA5` outline and text |
| `destructive` | 2px `#ffc9c9` outline and text (Cards only) | 2px `#b91c1c` outline and text |
| `quiet` | white, underlined | `#256AA5`, underlined |

- **Sizes:** `default` is 16px bold, radius 12, padding `0 18px`, 2px border, minimum height 44px on a touch pointer and 36px with a mouse; use it for Save, Cancel, the Management sticky bar and anything primary or frequent. `compact` is 14px semi-bold, radius 10, padding `0 14px`, 32px on every pointer, for secondary controls on dense admin tools only. Edit and Delete rows in a list card use the `compact` look (32px, 14px text) on every pointer; WCAG 2.2 AA asks for 24px, and the 44px size is the AAA target (see [ADR-0024](adr/0024-aa-target-sizes-and-card-density.md)).
- **States:** hover applies to a mouse only; pressed does not move the button; the 2px focus ring is always visible. Disabled is a `#cfdbe6` fill with `#4a5565` text on light surfaces, and no fill with a 1px dashed border and `#e0ecf6` text on dark ones. Every hover and pressed pair is in the contrast test.
- **Props:** `variant`, `size`, `href` (renders a link with the same look), `pending`, `pendingLabel`, `disabledReason`, `fullWidth`. A disabled button must have a `disabledReason`: the type refuses it, and the component throws outside production. The reason renders as text beside the button and is tied to it with `aria-describedby`.
- **Pending:** the label becomes "Saving…", the original label stays in the layout (hidden) so the width holds, further clicks are ignored and the button is `aria-busy`. The pending label is announced through the live region; the caller announces the outcome.
- **`IconButton`** requires `label` (the accessible name; the icon is hidden from screen readers) and is always 44px on touch.
- **`EntityRowActions`** renders Edit (`secondary`) and Delete (`destructive`) for a row; `name` makes each accessible name unique ("Edit Paracetamol").
- **Destructive on the canvas:** in development a `destructive` button directly on a canvas logs an error; the action belongs in a confirm modal. Put it on a Card (`data-card`) or a light surface.
- Filter chips, severity chips, tabs and toggles are not buttons.

Component tests for the shared components run in jsdom (`// @vitest-environment jsdom` at the top of the file, with Testing Library) and sit in `lib/__tests__/ui-*.test.tsx`.

#### Form fields

[`components/ui/FormField.tsx`](../components/ui/FormField.tsx) and the controls in [`controls.tsx`](../components/ui/controls.tsx). Every control sits inside a `FormField`, which gives it a programmatic label. Wrap fields in `.fc-form` for 16px between fields; label, hint and control are 4px apart.

- **Surface:** forms live on `surface-panel`. **Labels:** no trailing colon, 14px bold `text-primary`; an optional field is marked "(optional)" in regular weight `text-secondary`; stacked by default. `layout="inline"` (a 72px fixed label column) is for the Date and Time rows only.
- **Controls** (`Input`, `Select`, `Textarea`): white fill, 1.5px `#4A5565` border, radius 8, 16px text, minimum height 44px on touch and 36px with a mouse. A select keeps its native arrow. Disabled is a `#cfdbe6` fill with a dashed border; error is a 2px `#B91C1C` border; focus is a 2px `#256AA5` ring with a 2px offset; the placeholder (`#5F6B7A`) is an example only, never the label.
- **Hint and error:** the hint (14px `text-secondary`) sits between label and control; the error (14px bold `#B91C1C`) sits below the control with a leading "⚠" and the red border. The control gets `aria-describedby` for both and `aria-invalid` while an error shows. A control with its own `aria-label` (the "Unit" selector in a value-and-unit pair, inside a `FieldRow`) names itself and takes no id from the field.
- **On submit:** call `focusFirstInvalid(form)` from [`lib/ui/form-errors.ts`](../lib/ui/form-errors.ts) after the errors render. It focuses the first invalid field and announces "2 problems to fix. First: Name." assertively.
- **`Checkbox`:** a 24px box in `#256AA5`, the box and label one tappable row, at least 44px high on touch. **`Toggle`:** label and switch tied together as a `switch` with that name, 44px high on touch; an optional `hint` is helper text tied to the switch, shown alongside any `disabledReason`. **`FieldGroup`:** a `fieldset` with a `legend` styled as a field label, for Administered by, Severity and filter options.
- **`FileInput`:** a secondary "Choose file" button opens the picker; the real input is visually hidden but in the page and labelled by the field label. A chosen file shows its name, the button reads "Change file" and a quiet "Remove" clears it; "No file chosen" otherwise. Choosing a file is announced. Put the accepted types and size limit in the field hint ("PDF, JPEG, PNG or WebP, up to 20 MB").
- **Date echo:** `DateEcho` renders the line under a date input that spells the date out ("Friday 9 October 2026"). A form with a Date and a Time row shows one combined line under the pair ("Friday 9 October 2026, 11:03 pm").
- **Announcements:** [`lib/announce.ts`](../lib/announce.ts) is how components speak to screen readers. `announce(message, "polite" | "assertive")` reaches the app-wide live region once it is mounted, and does nothing before then.

#### Chips and the severity slider

[`components/ui/Chip.tsx`](../components/ui/Chip.tsx) is the one chip, in three kinds. Filter chips, severity chips, tabs and toggles are chips, not buttons.

| Kind | Use | Markup |
|---|---|---|
| `choice` (through `ChipGroup`) | Pick one: History filters and summary kinds, Administered by, time offsets | `fieldset` with a `legend`, containing a `radiogroup` of `radio` chips; one tab stop, arrow keys (and Home and End) move the selection |
| `toggle` | Pick any: test-chart series | `button` with `aria-pressed` |
| `disclosure` | For symptom, For dose | `button` with `aria-expanded`, an emoji, 14px text and a trailing chevron (▾ closed, ▴ open) |

- **Look:** a pill, 14px semi-bold, 32px visible height with the tap target extended to 44px on touch. Selected shows a "✓" prefix **and** a fill. Dark surfaces: unselected 1.5px `#e0ecf6` border with white text, selected solid `#124F7A`. Light surfaces: unselected white with a 1.5px `#4A5565` border and `#1e2939` text, selected `#256AA5` with white text. Hover (mouse only) fills unselected dark `#124F7A` or light `#eaf3fa`, and selected one step darker (dark `#0F4468`, light `#1A5F96`); pressed matches hover and does not move. Colours follow the `Surface`; every pair is in the contrast test.
- **`SeveritySlider`:** a native range input (1 to 5, step 1) that starts at **1**, 44px high on touch, accent `#256AA5`, with the numbers 1 to 5 and the words Mild, Moderate and Severe under 1, 3 and 5, the value shown as "n of 5", and `aria-valuetext` "n of 5". Put it in a `FormField` labelled "Severity".

#### Empty states and banners

- **`EmptyState`** ([`components/ui/EmptyState.tsx`](../components/ui/EmptyState.tsx)): centred on the canvas with no card, everywhere including admin. An emoji icon (44px, hidden from screen readers), a heading (20px bold, a real `h2`, `text-on-brand`), copy (`text-on-brand-muted`, at most 34 characters wide, saying what to do next) and an optional primary Default `Button`, shown only when the person can act. `EMPTY_STATE_ICONS` names the icon for each situation, so the same situation always gets the same icon (people 👨‍👩‍👧, medications 💊, records 📋, observations 📊, symptoms 🤒, test results 🧪, observation types 📏, schedules 🗓️, accounts 👥, favourites ⭐, audit entries 🧾, files 📁, sessions 🔑, access denied 🔒, page not found 🔍, invalid link 🔗, error ⚠️, desktop required 🖥️); a migration adds a row when its screen is not listed. Dead-end screens (access denied, page not found, invalid link, the error boundary) use the same component. The error boundary is [`app/error.tsx`](../app/error.tsx) and [`app/global-error.tsx`](../app/global-error.tsx) (which carries its own `html` and `body`, since the root layout is gone), both rendering [`components/ErrorScreen.tsx`](../components/ErrorScreen.tsx) with the header title "Error" and Try again / Go Home.
- **`Banner`** ([`components/ui/Banner.tsx`](../components/ui/Banner.tsx)): one component, four kinds, each with an icon, a bold lead word and text so meaning never relies on colour.

| Kind | Fill | Border | Text | Icon |
|---|---|---|---|---|
| `info` | `#D8E9F5` | `#88B8D8` | `#1e2939` | ℹ️ |
| `warning` | `#fffbeb` | `#fde68a` | `#92400e` | ⚠️ |
| `error` | `#fef2f2` | `#fecaca` | `#991b1b` | ⛔ |
| `success` | `#f0fdf4` | `#bbf7d0` | `#166534` | ✅ |

  A banner already present at load is plain content. Pass `announced` for one that appears after an action: it is announced politely through the live region. An `error` banner uses `role="alert"` and is not announced a second time. `onDismiss` adds a Dismiss button. A banner declares a light `Surface`. Banners replace loose red and green page-level text.
- **Modals:** every modal panel uses the banner colour (`surface-panel`) and declares a light `Surface`, so buttons inside take their light colours.

#### List cards and badges

- **`ListCard`** ([`components/ui/ListCard.tsx`](../components/ui/ListCard.tsx), inside a `CardList`, 6px apart): the one row for History, People, Medications, Observation Types, Accounts, Schedules and Goals and the schedule lists, on the solid `surface-action` Card (radius 10, `8px 10px` padding, 6px between cards, 22px emoji icon). It declares a dark `Surface` and `data-card`, so destructive buttons are allowed on it.
  - **Leading:** a 22px emoji `icon` or a 40px `avatar` (photo or initials), hidden from screen readers.
  - **Title:** 16px bold white; it **wraps and never truncates**. With `href` it is a link whose accessible name is the visible title (no `aria-label`).
  - **Meta line:** 14px `text-on-brand-muted`, `meta` parts joined with " · " and **the time first** ("7:46 pm · 250 mg · Fever"); `note` (free text such as a comment) goes last, in italics.
  - **Extras:** an optional line for links (24px minimum height) and `Badge`s.
  - **Trailing:** `EntityRowActions` (32px compact buttons, top-anchored), or a named `Toggle` for the Active switch on Observation Types. A card with no actions (Audit Log) has none, and its timestamp joins the meta line, with seconds.
  - **`inactive`:** the same Card dimmed through the disabled tokens (no fill, dashed border, `#e0ecf6` text) at AA.
- **`Badge`** ([`components/ui/Badge.tsx`](../components/ui/Badge.tsx)): a self-contained pill with solid fill and dark text, never transparent. Tones: `warning` (Moderate), `success` (Active), `neutral` (Inactive), `info`, `error`. Values are the `badge-*` tokens.

#### Hubs and panels

- **`HubGrid` / `HubTile`** ([`components/ui/HubTile.tsx`](../components/ui/HubTile.tsx)): the tile hub on Management, Administration and Diagnostics: a solid `surface-action` card with icon, bold Title Case title and a one-line description in an auto-fit grid (200px minimum, 12px gap).
- **`Panel`** ([`components/ui/Panel.tsx`](../components/ui/Panel.tsx)): the light `surface-panel` container for forms (`as="form"` for a form), with `.fc-form` spacing. **`FcTabBar`** now lives in `components/ui` (arrow keys move between tabs).
- Client code reads invite status from [`lib/account/invite-status.ts`](../lib/account/invite-status.ts), which has no server-only imports; SQLite `CURRENT_TIMESTAMP` values go through `sqliteUtcToIso` before display.

- **Management:** the sticky "+ Add" bar is `ManagementStickyAdd` (a `primary` Default full-width `Button`, last inside the `PageContainer`); catalogue lists are `ListCard`s with `EntityRowActions`; the Active switch on Observation Types is the shared `Toggle`, and an inactive medication is a dimmed `inactive` card with an Inactive `Badge`. Edit modals use `FormField` controls and `Button`s on the banner colour.

- **Record forms:** [`RecordShell`](../components/RecordShell.tsx) is the page around every Record form (top bar, the person's header, the breadcrumb and the form on a light `Panel`); `RecordLoading` is its loading state. [`RecordDateTime`](../components/RecordDateTime.tsx) is the "Record now" switch with the inline Date and Time rows, the one spelled-out line under the pair and the timezone hint; the rows are disabled while Record now is on, with the reason as text. A text input that offers matches (Medication, the test metric search) puts a [`SuggestionList`](../components/ui/SuggestionList.tsx) under it, inside one wrapper with the input so moving focus into the list does not close it. Pick-one groups (Administered by, Update or add, the Hydration amount) are `ChipGroup`s, pick-any groups (reminder times, linked symptoms and doses) are toggle `Chip`s and "For symptom / For dose" is a disclosure `Chip`. Status messages (dosing guide, weight on file, over the limit) are `Banner`s. A field problem sets the `FormField` error and calls `reportProblem` (focus plus the assertive announcement); a general failure is an error `Banner`. [`disabledWhen`](../lib/ui/disabled-props.ts) spreads onto a `Button` that is sometimes unavailable so the reason always travels with the flag. `FileInput` takes `onBeforeChoose` to run just before the picker opens (the app lock suppression for the report upload). [`Hotspot`](../components/ui/Hotspot.tsx) is a named tappable area laid over a canvas (the boxes in the redaction check) and `ImageButton` wraps non-text content as one control.

- **Person hub and History:** the person hub's top bar reads "Select an Action" and the person's name is in the page, beside the avatar and status line; the page is a `PageContainer` with the Home › Name breadcrumb, the save flash, the status region (alerts and the medication timeline in a swipeable region whose page indicator is [`SlideTabs`](../components/ui/SlideTabs.tsx), a tablist you can drive with the arrow keys) and the action tiles (`HubGrid dense`, with `HubButtonTile` for "More"). The alert and timeline panels are solid `surface-action` Cards (no translucent fills); timeline markers are [`MarkerButton`](../components/ui/MarkerButton.tsx)s. History keeps its logic in `app/[personId]/history/page.tsx` and its parts in `components/history/`: every feed row is a `ListCard` under a day heading (time first in the meta line, the comment last in italics, badges and link chips in the extras line, `EntityRowActions` at the end); a row being edited is replaced by a light `Panel` form built from `FormField` controls (`MedEditForm`, `ObsEditForm`, `BpEditForm`); the range fields, kind filter (`ChipGroup`) and record-type filter are shared parts; observation records are a `RecordTable`; and the Calendar tab is `HistoryCalendar`, whose days are [`DayButton`](../components/ui/DayButton.tsx)s named by what is on the day. A Summaries row is a `ListCard` whose title link takes the visible title as its name. The schedule lists (medication schedules, observation reminders and goals) are `ListCard`s with `EntityRowActions`; a row opens its editor as a light `Panel` below it. The header menu items are [`Menu`](../components/ui/Menu.tsx) parts, and the Quick record sheet is a light dialog with a `Button` per favourite (an unavailable one says why in text).

- **Sign-in screens (Login, Setup, invite and reset):** [`AuthShell`](../components/AuthShell.tsx) is the narrow 448px `PageContainer` with the logo and heading on the canvas; the form sits in `AuthCard`, a light `Panel`. Every field has a visible label and hint (Email address, Password with "At least N characters." read from the real setting, Confirm password, Authenticator code "(optional)", and the Setup email fields), and `PasswordField` adds the "Show password" checkbox under a password input (it only switches the input type, so pasting and password managers are untouched). A failed sign-in is an error `Banner`, "Email or password is incorrect." (deliberately generic), with focus returned to the email field. The Setup step indicator stays on the canvas above the card ("Step 2 of 4"). A missing or unusable invite or reset link is the shared `EmptyState` dead end (🔗 "This invite link isn't valid" or "This reset link isn't valid", with Back to sign in), and Access denied and Page not found use the same component with Go Home.

#### App chrome

- **`PageContainer`** ([`components/ui/PageContainer.tsx`](../components/ui/PageContainer.tsx)): sets the area's Canvas (`area="app"` or `"admin"`, both already dark), is the single `main` landmark with the `main-content` id and `tabindex="-1"` (the skip-link target), and applies the width and spacing rules. A page cannot set its own padding or width. Width is `page` (768px, every screen), `full` (no cap; no screen uses it now, Admin included, until the desktop layouts) or `narrow` (448px: Login, Setup, invite and reset cards); modals keep their own widths. The caps are `--fc-page-width*` in `globals.css`, so 1.2.0 breakpoints can raise them. Spacing: 16px side gutter, 12px top, 32px bottom, 12px between blocks (gap). Its optional `back` prop renders the back link first, and its optional `tabs` prop pins a tab strip (`FcTabBar`) to the top of the page inside the `main` landmark.
- **Save feedback and form errors**: a successful save from a Record form calls `setSaveFlash(message)` ([`lib/ui/save-flash.ts`](../lib/ui/save-flash.ts)) before redirecting to the person hub; `SaveFlash` on the hub reads it once from session storage (not a URL parameter) and shows a dismissible success `Banner`, announced politely. A failed validation calls `reportProblem(fieldId, label)` or `focusFirstInvalid(form)` ([`lib/ui/form-errors.ts`](../lib/ui/form-errors.ts)): focus moves to the first invalid field and "1 problem to fix. First: <label>." is announced assertively. The closed Quick record sheet is `inert`; open, it traps Tab, closes on Escape and returns focus to the ⭐ button.
- **`Breadcrumb`** ([`components/ui/Breadcrumb.tsx`](../components/ui/Breadcrumb.tsx)): the trail up the app's structure, a `nav` named "Breadcrumb" holding an ordered list. Every level above the page is a link (or an in-page step with `onClick`, such as "All values" on the Test Result Chart or the Summaries list), and the page itself is the last item as plain text with `aria-current`. The nearest parent carries a "‹". Pages pass `trail` to `PageContainer` (built with the helpers in [`lib/ui/breadcrumbs.ts`](../lib/ui/breadcrumbs.ts)) and a Person header through `header`, so the order is Person header, trail, content. It goes **up one level in the app's structure, not back in browser history** (Person hub → Home; History, Record forms, Schedules & Goals and Test Result Chart → the person hub, labelled with the person's name; Management sub-pages → Management; Admin sub-pages → Administration; Diagnostics tools → Diagnostics). Home, Profile, Favourites and the three hubs have none. Link names are the visible text. The top-right chevron (`BackButton`) and the "Back to Administration" text links are removed.
- **Header** (`AppHeader`): three parts (menu, flexible title, Quick record and logo) in a fixed 72px bar. The title is 24px bold at 400px and wider and 20px below, on one line with an ellipsis, and the `h1` still carries the full text (also a tooltip). The menu and Quick record controls are `IconButton`s (44px on touch, 36px with a mouse).
- **Footer** (`AppFooter`): sticky, two lines on a phone (about 56px). Line 1 is "Version … · Source · Licences · Diagnostics" in `text-secondary`; line 2 is "© year WheelieLabs · AGPL-3.0" on phones and the full text on wider screens. Links have a 24px minimum height with spacing.
- **Skip link** (`SkipToContent`, in the root layout) goes to `main#main-content`. **`<html lang="en-AU">`.**
- **Live region** ([`components/ui/LiveRegion.tsx`](../components/ui/LiveRegion.tsx), mounted once in the root layout): a visually hidden polite `status` region for announcements (saved, file chosen, pending result) and an assertive `alert` region for a failed submit. Speak through `announce()` in `lib/announce.ts`; announcing the same text twice still works.
- **Landmarks per page:** one banner, the primary `nav`, exactly one `main` (from `PageContainer`) and one footer.

#### Dates and times

[`lib/date-format.ts`](../lib/date-format.ts) is the one display formatter (`Intl`, no hand-written month arrays). `getDisplayLocale()` is the constant `en-AU`; the browser's locale is never used for display. `getDisplayTimeZone()` is the instance timezone (`instanceTimezone` on `GET /api/me`, set once on the client with `setDisplayTimeZone`); server code passes `timeZone` explicitly. A bare `YYYY-MM-DD` is printed as that calendar day with no zone shift. "Sept" for September is accepted.

| Function | Example |
|---|---|
| `formatDate` | `9 Oct 2026` |
| `formatDateShort` (same year as now) | `9 Oct` |
| `formatWeekdayDate` | `Fri 9 Oct` |
| `formatTime` | `7:46 pm` |
| `formatDateTime` | `9 Oct 2026, 7:46 pm` |
| `formatDateTime` with `seconds` (Audit Log only) | `9 Oct 2026, 10:47:00 pm` |
| `formatRange` | `2 Oct – 9 Oct 2026` |
| `formatDobWithAge` | `2 Apr 2015 · 11 yrs` |
| `formatElapsed` | `5 min ago`, `yesterday`, `in 40 min` |

Parsing helpers (`localDateAndTimeToUtcIso`, `ianaLocalYmdHmToUtcMs`, …) stay in [`lib/datetime.ts`](../lib/datetime.ts). A typed date and time are read in the instance timezone (`localDateAndTimeToUtcIso` takes a `timeZone`, defaulting to the display zone from [`lib/display-time-zone.ts`](../lib/display-time-zone.ts)); `instantToZonedYmdHm` and `zonedTodayYmd` are the matching reads back into date and time inputs, so the device's zone is never used for entry. `DisplayTimeZone` in the root layout sets the zone from `GET /api/me`, and `TimeZoneHint` shows "Times are in …" under a time field when the device's offset differs. Screens adopt the formatter as they migrate; until then `toLocale*String` call sites remain.

#### Enforcement

`npm run lint` fails on a raw `<button>`, `<input>`, `<select>` or `<textarea>`, on `toLocale*String` and `Intl.DateTimeFormat` used for display, on translucent `text-white/NN` and `bg-white/NN` classes, and on a hand-rolled `max-w-*` on a page's `main` or its direct child. The selectors are in [`eslint/ui-restrictions.mjs`](../eslint/ui-restrictions.mjs); `components/ui/`, `lib/date-format.ts` and tests are never covered. There is no exemption list; a deliberate exception takes a targeted `eslint-disable-next-line` with a reason. The one file-level waiver is Import Records (`app/(writable)/management/import/page.tsx`), which keeps its current styling until the 1.2.0 desktop layouts restyle it; remove the waiver when that lands. See [ADR-0023](adr/0023-centralised-ui-components-and-enforcement.md).

#### Browser tests (accessibility)

`npm run test:ui` runs Playwright and `@axe-core/playwright` ([`playwright.config.ts`](../playwright.config.ts), [`e2e/`](../e2e/)) in its own CI workflow ([`.github/workflows/ui.yml`](../.github/workflows/ui.yml)). It builds the app (`npm run test:ui` runs `npm run build` first; `npx playwright test` alone expects a current build), starts it on a scratch database in the temp directory (never `data/familychart.db`), and seeds it through the app's own API (an administrator, two people, two medications with a frequency rule and a schedule, doses, observations including a blood pressure pair, a test result with a report, a symptom linked to a dose, an inactive person and a second Account). Set `FC_UI_DEV=1` to use the dev server instead of the build, or start a server yourself on port 4100 and set `FC_UI_REUSE_SERVER=1` to skip the build. A run takes under a minute including the build (the app is started by `e2e/server.ts`, not Playwright's `webServer` option, whose port probe can hang for two minutes on some networks); while iterating, run only the routes you changed with `npx playwright test -g "/admin"`.

- **Axe scan:** `e2e/axe.spec.ts` scans every route in `e2e/routes.ts` at 390px and 1280px against WCAG 2.2 AA, including colour contrast. Known violations are listed per route and rule in `e2e/axe-allowlist.json`. The list only shrinks: a new violation fails the test, and so does an entry that no longer fires. After fixing a screen, run `FC_UI_WRITE_ALLOWLIST=1 npx playwright test axe` (it runs in parallel) and commit the smaller file; it can only remove entries, and you must never add one to get a change through. The scan uses tall windows (390x2400 and 1280x1800) so a control half under the sticky footer cannot fail `target-size` by accident. Add a page's route to `e2e/routes.ts` when you add the page. States the route scan cannot reach get their own axe check: `e2e/entra-gap.spec.ts` switches Entra sign-in on through System Settings (credentials held there, so Graph is not configured), checks the Entra access warning banner on `/admin/overview` and `/admin/entra-sessions` (plus the counted variant, with the page's data stubbed) at both widths with no allowlist, then switches it off. Person erase runs as its own project after the default project, because those tests add people to the shared database and the export checks count the seeded household. The Entra check runs as its own Playwright project after every other test, because the setting changes the sign-in page and the Administration overview.
- **Accessibility tree:** `e2e/accessibility-tree.spec.ts` asserts roles, names and landmarks as a screen reader gets them. Each slice adds assertions for what it fixes.

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
| `FC_AUTH_ENTRA_ENABLED` | Optional | Enable Microsoft Entra sign-in (`true` or `false`). Default: `false`. When unset, `auth.entra.enabled` in System Settings applies. Local credentials stay available. |
| `AUTH_MICROSOFT_ENTRA_ID_ID` | Entra only | Azure app registration client ID. Grant app-only `User.Read.All` + `GroupMember.Read.All` on this app registration to also enable live background revocation ([ADR-0009](adr/0009-entra-live-revocation.md)) — optional, sign-in works without it. |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | Entra only | Azure app registration client secret |
| `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID` | Entra only | Azure tenant ID |
| `ENTRA_GROUP_ADMIN` | Entra only | Entra security group OID for Admin role |
| `ENTRA_GROUP_MANAGER` | Entra only | Entra security group OID for Manager role (`canManage`) |
| `ENTRA_GROUP_READWRITE` | Entra only | Entra security group OID for ReadWrite role |
| `ENTRA_GROUP_READONLY` | Entra only | Entra security group OID for ReadOnly role |
| `ENTRA_GROUP_REPORTS` | Entra only | Entra security group OID for Reports role |
| `DB_PATH` | Optional | SQLite file path (default: `./data/familychart.db`) |
| `FC_RESTORE_MAX_UPLOAD_MB` | Optional | Largest restore upload in megabytes (default 512). A reverse proxy must allow at least this body size. |
| `BEHIND_REVERSE_PROXY` | Optional | Unified reverse-proxy mode ([ADR-0007](adr/0007-reverse-proxy-mode.md)) |
| `TRUST_PROXY_DEPTH` | Optional | XFF trusted hops when behind proxy; default `1` |
| `VAPID_SUBJECT` | Push only | `mailto:` URI for VAPID (e.g. `mailto:admin@example.com`) |
| `VAPID_PUBLIC_KEY` | Push only | VAPID public key (base64url) |
| `VAPID_PRIVATE_KEY` | Push only | VAPID private key (base64url) |
| `CRON_MODE` | Optional | Set to `internal` to run cron jobs in-process via `instrumentation.ts` (fires every 5 min after a 30s startup delay). When unset, use an external caller hitting `GET /api/cron`. |
| `CRON_SECRET` | Required for external cron | External cron callers must send header `x-cron-secret`; `GET /api/cron` returns 401 when it is unset. Not used when `CRON_MODE=internal` |
| `FC_SCHEDULE_LEAD_MINUTES` | Optional | Minutes before a slot to show amber upcoming alerts. Default: `60`. |
| `FC_SCHEDULE_OVERDUE_OFFSET_MINUTES` | Optional | Minutes after nominal slot time before overdue push. Default: `30`. |
| `FC_DEFAULT_TIMEZONE` | Optional | Instance default IANA timezone; when set, locks the admin control |

---

## Push notifications and cron

Web Push is optional and requires VAPID keys. `lib/push.ts` handles delivery; `lib/cron.ts` contains the reminder jobs. Each tick loads the active People set once, calls `evaluateAlertReadiness` (`lib/alert-readiness.ts`), then the PRN / scheduled / observation jobs filter those facts. Hydration stays on its own evaluator.

- **PRN reminders** — facts with `remindAfterDue` (pending `prn_push_requests` after cooldown, not at cap; same `evaluatePrnState` seam as dashboard/UI; includes `max_hours_between` and last-dose `remind_after_hours`), notifies subscribers who enabled `notify_prn`. Recording a newer dose for the same person + medication (or sibling group, via `getGroupSiblingIds`) hard-deletes older pending `prn_push_requests` for chronologically earlier doses (`lib/prn/prn-push-supersede.ts`, `clearSupersededPrnPushRequests`) — a stale request can no longer fire under the newer dose's cooldown clock. Cleared on record create (`POST /api/records`, spreadsheet import) and on `PATCH` only when `recorded_at` actually changes; a record never clears its own request.
- **Schedule creation boundary:** `person_medications.schedule_created_at_ms` is set when an assignment gains a running schedule (POST, or PATCH from no schedule or inactive) and never on later edits. `isSlotBeforeScheduleCreation` in `lib/schedule/schedule-slot-evaluator.ts` is the one rule, applied wherever slots are walked (`collectDueScheduledSlots`, the dashboard timeline, slot outcomes and the Missed sweep, pending dose expectations): a slot on the start day that is also the creation day, earlier than the creation instant, is not an expectation. A backdated start date keeps its slots; NULL (older rows) means no boundary. Carried as an optional assignment field in the Person export and restore.
- **Scheduled dose reminders** — `due` / `overdue_push` Scheduled slot facts from Alert readiness (`collectDueScheduledSlots` in `lib/schedule/schedule-slot-evaluator.ts`, timings from `lib/schedule/schedule-config.ts`: defaults 60 min upcoming lead, 30 min overdue push offset, fixed 30 min push-delivery window). Fires `notify_prescribed` during the due window and `notify_overdue` during the overdue-push window. Slots under a dose expectation are skipped, as are slots whose own dose has already been recorded within the slot's clearance window (`isSlotClearedByDose`, 3-day lookback). A medication currently blocked by its own PRN cooldown/24h cap appears as a `prnBlockedSlots` fact and does not fire a scheduled push. The exception is a medication with a schedule in effect today whose 24h maximum allows exactly one dose (a count of 1, or a quantity of one dose unit): Alert readiness treats its cap as expected, so it raises no `atCap` flag (no dashboard "at 24h max" alert) and its slots stay Scheduled slots; cooldown still blocks. `allowsOnlyOneDosePerDay` in `lib/prn/prn-eval.ts` with `isAssignmentScheduledOnYmd` and `evaluateMedicationPrnState` in `lib/alert-readiness.ts` are the only place this is decided; the per-person medication timeline calls the same two functions for every lane, so its cap flag and band, and its cooldown band, show exactly when the dashboard raises the matching alert (a scheduled lane has no next-eligible marker; the key lists the Cooldown and 24h cap bands when a lane draws them). "Scheduled" uses `isScheduleInEffectOnYmd` (started, not ended), not `isScheduleActiveOnYmd`, so a weekly schedule on an off weekday is still scheduled and its expected cap does not turn into an alert on those days. Record Medication is unchanged. Scheduled/overdue push deep links carry the per-slot `dosage` so the Record form prefills it.
- **Dose expectation reminders** — pending Dose expectations from Alert readiness (`pendingDoseExpectations`, [ADR-0017](adr/0017-dose-expectations.md)) that are still fresh for push (`isFreshForPush`); key `dose-expectation:<expectation_id>:<ymd>`, notifies `notify_prescribed` subscribers. Needs an instance IANA timezone.
- **Overdue dose reminders** — see above; fired as part of the same scheduled reminders loop.
- **Observation overdue** — overdue Observation expectation facts (`isObservationAlertEligible` in `lib/observation/observation-schedule.ts`: overdue AND catalogue entry AND not aged out of `max_age_years`). `notify_observations`. Delivery still requires an instance IANA timezone.

- **Self notifications (the recorder's own copy).** Saving a dose or hydration reading changes the notification the recorder is still showing. The recording device names itself on the save request with the `x-fc-push-endpoint` header (its own push subscription endpoint, used only to skip that device when sending and never stored or logged; `lib/push/recording-device.ts`), closes or quietly updates its own notification by tag (`lib/push/notification-client.ts`, best effort), and every other device is reached by push. Tags are shared in `lib/push/notification-tags.ts`: `medication-reminder-<person>-<medication>` (PRN, scheduled and overdue reminders and the acknowledgement), `dose-expectation-<person>-<medication>` and `hydration-reminder-<person>`.
  - **Dose.** `decideDoseNotification` (`lib/push/dose-notification-decision.ts`) turns `recordDose` / `answerDoseTiming` results into data: `{ closeTag, replaceOnRecorderDevices }`. Only a dose attached to a slot (On time, or answered Late or Early) or a slot that became Missed for that medication clears the reminder; a PRN, unscheduled or extra dose, and a dose still waiting for its prompt, do not. `POST /api/records` and `POST /api/records/[id]/timing` return `closeNotificationTag`, and when it is set `sendSelfDoseAcknowledgementPushes` sends "You gave <Person>'s <medication> at <time>" on the same tag to the recorder's Account's other devices (recording device skipped; if it is unknown every device of the recorder gets it). Other Accounts keep the "<name> gave…" acknowledgement. The dose-expectation resolve route returns the `dose-expectation-…` tag for Given and Not given so the answering device closes the question; a Missed slot raises no push of its own, so a slot that times out in cron leaves its reminder on screen until dismissed or replaced, since a push cannot clear a notification remotely ([ADR-0030](adr/0030-self-dose-and-hydration-notifications.md), [ADR-0029](adr/0029-dose-timing-and-missed.md)).
  - **Hydration.** After a Hydration reading is saved, `planHydrationNotification` (`lib/hydration/hydration-notification.ts`) recomputes pacing with the existing evaluator and returns clear, update (the new glass count) or none. Nothing is sent while muted today, when no pacing nudge is outstanding (one went out in the last day and no reading has come since, from `hydration.last_nudge_at` and `hydration.last_record_at`), outside the active window, or without a goal or linked Account. Clear sends a quiet "<Person>: Caught up" on the nudge tag with `closeAfterMs: 4000`; update sends the nudge body quietly. Both carry `silent: true`, are not written to `notification_log`, go to the linked Account only (`notify_hydration`, `linkedAccountOnly`), and skip the recording device. `POST /api/observations` returns `hydrationNotification` (`close` or `update` with the payload) for the recording device to apply to a notification it is already showing; it never creates one. An update moves `hydration.last_nudge_at` to now so the nudge stays outstanding; a clear moves `hydration.last_record_at`, so the next reading sends nothing.
  - **Service worker.** `public/sw-push.js` passes `silent` to `showNotification` and, when a payload has `closeAfterMs` (capped at 10 seconds) and a tag, closes notifications with that tag after the wait, keeping the worker alive with `waitUntil`.

`push_log` deduplicates sends via a unique `ref_key` (e.g. `prn:<record_id>`, `scheduled:<pm_id>:<ymd>:<hhmm>`).

Person-scoped pushes go through `dispatchPersonPush` → `resolveSubscribersForPerson` (always applies `pushSubscriberStillAuthorised`) → `sendAndLogPush`, which writes one `notification_log` row per distinct recipient `user_uid`. Profile → Notifications → History reads via `GET /api/me/notification-log`. `POST /api/push/test` sends without logging.

Cron runs are triggered either internally (set `CRON_MODE=internal`; `instrumentation.ts` calls `initInternalCron()` on startup) or externally via `GET /api/cron` (the `x-cron-secret` header must match `CRON_SECRET`, which is required; the route returns 401 when it is unset and 404 under `CRON_MODE=internal`).

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

## Person action screen status region

The status region above the tile grid is a swipeable pair of panels, Alerts and Medication timeline, always both present (page indicator always shown) and always the same fixed height (`STATUS_PANEL_HEIGHT_PX` in [`lib/person/action-screen.ts`](../lib/person/action-screen.ts)), so the grid below never moves. An empty Alerts panel centres its message; an empty timeline shows "No recent or upcoming medication activity" under the usual title. The region opens on Alerts when there are any, on the timeline only when there are no alerts and it has lanes to show, and always on the timeline for a `?timeline=` link; the starting slide is decided once the dashboard has loaded. A lane exists only with a marker. Timing comes from stored slot outcomes, not from pairing a dose to a nearby slot: a taken marker carries its `timing` (On time, Late, Early or none) and ring colour; a slot with a dose attached is `resolved` (no marker), one that ended with no dose is a `missed` cross, and every slot time is a dotted `slotLines` entry. A Missed slot also appears on the Alerts panel as a quiet informational line (`missedSlots` on the dashboard payload; never counted as an alert or in the status, shown for the Calendar day it became Missed). History: `GET /api/records` adds `timing` for scheduled medications; `GET /api/dose-missed` returns Missed slots (and Not given answers from before slot outcomes existed), shown as red-edged `MissedDoseCard` rows (a `ListCard missed` with an error `Badge`) in the Live Feed, the Calendar and, with `medication_id`, a medication's Summaries list (merged with its doses by `mergeMissedIntoRecords`).

## History rows: date-only kinds and day order

Symptoms and test results are recorded for a day, not a time, so their History cards never show a time of day (`feedRowTimeText` in [`lib/history/feed.ts`](../lib/history/feed.ts) returns null for date-only kinds); a symptom card shows its date range, or "From <date>" while open. Within one local day the Activity feed and the Calendar day panel order rows as symptoms first, the day's other records newest-first, then test results last (their cards are tall), with the row id as a stable tie-break. Symptoms keep their stored local-midnight timestamps; a device in a different timezone from the one that recorded a symptom can show the neighbouring day (a known limit; true date-only storage is a possible later change).

## Test result chart

The action screen's **Test Result Chart** tile (the 7th of the 8-tile cap) opens `/[personId]/test-chart`. The chosen series (`metric`), panel (`panel`), ticked metrics (`show`) and range (`range`, `from`, `to`) live in the query string. Data comes from `GET /api/test-results/series?person_id=` (list of series with two or more numeric values, one per metric and unit, plus panels with two or more qualifying series) and the same route with `metric` (+ `unit`, `from`, `to`) for one series' points. It does the same `"read"` person check as `GET /api/test-events` and is metric-scoped, so it is not subject to the shared history row cap. Panels are looked up at read time by joining the stored `metric_name` to `test_metric_config.panel` (case-insensitive, inactive metrics included); nothing is stored per value. The pure grouping, panel lookup, reference-range parsing (plain "low - high" only; anything else leaves a gap) and band-stepping live in [`lib/test-results/test-metric-series.ts`](../lib/test-results/test-metric-series.ts); drawing is in [`components/TestMetricChart.tsx`](../components/TestMetricChart.tsx).

## Test result PDF prefill

Record Test Result can suggest values from an attached PDF's text layer ([ADR-0020](adr/0020-text-layer-pdf-prefill.md)). The pure extraction and catalogue-matching rules live in [`lib/test-results/pdf-prefill/`](../lib/test-results/pdf-prefill/) (`extract.ts`, `match.ts`), and the browser-only pdf.js glue in `read-pdf.ts`. The `pdfjs-dist` worker, standard fonts and wasm are served from `public/pdfjs`, copied from `node_modules` by `scripts/copy-pdfjs-assets.mjs` on `predev` and `prebuild` (gitignored, so `npm run dev` and `npm run build` regenerate it). Parsing happens on the phone; nothing about the report is sent to the server until the carer saves. Every attachment is redacted on the phone before it is uploaded ([ADR-0021](adr/0021-report-redaction-before-upload.md)): the pure rules live in [`lib/test-results/redaction/`](../lib/test-results/redaction/) (`detect.ts` suggestions, `boxes.ts` page-fraction boxes, `review-state.ts`, `assemble.ts` pdfkit writer, `redact-pdf.ts` and `verify.ts`), the browser rendering in `browser.ts`, and the review screen in `app/[personId]/record-test-result/RedactionReview.tsx`. The server stores only the redacted file; the original is never uploaded. On the edit screen of a result with a PDF attachment, "Rescan report" fetches the stored file back through the authenticated uploads route as a blob and reads it the same way (no re-upload, the attachment is unchanged); [`withoutExistingMetrics`](../lib/test-results/pdf-prefill/rescan.ts) hides suggestions for metrics already on the result, and every rescan is a fresh pass (skips are not remembered). Photo attachments are not rescanned.
