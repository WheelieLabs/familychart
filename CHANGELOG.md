# Changelog

All notable changes to FamilyChart are documented here for maintainers and contributors.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
User-facing release notes for the in-app What's New screen live in [`WHATS_NEW.md`](WHATS_NEW.md).

---

## [Unreleased]

---

## [1.0.12] - 2026-10-03

### Changed
- Profile → Account → App lock: the "Disable on this device" toggle now sits above the Save button
- Hydration presets are now Mug 250 mL, Can 375 mL, Glass 400 mL, Bottle 600 mL (previously 150/250/330/500)
- App lock rework (ADR-0016): device-bound credential (`residentKey: "discouraged"`) with a one-time re-setup, no 8s cutoff (65s safety net plus a visible Cancel), fail-closed lock state machine, opt-in per-device grace period, fresh re-auth required to turn App lock off (Profile and lock screen), photo/camera suppression cap of 2 minutes, ceremony failures logged server-side
- Lock screen offers "Turn off App lock on this device" only after the fix steps have failed (set-up-again failed, or three consecutive failures), behind a risk confirmation; "Sign out" is always available

### Added
- Hydration favourites accept a pre-set amount (whole mL, 1–10000) stored in `favourites.default_value`; `favouriteRecordHref` passes it as `amount` to the record page, which pre-fills it. The API rejects `default_value` on other observation types
- Diagnostics area, linked from the footer (signed-in and unlocked only), with an App lock tool: probe option sets A–D, device App lock state panel, copy log

---

## [1.0.4] - 2026-09-13

### Changed
- v1.0.4 — biometric unlock reset when the stored credential is permanently invalid

## [1.0.3] - 2026-09-12

### Changed
- v1.0.3 — recover from hung WebAuthn ceremony when abort isn't honored; shorten unlock timeout to 8s

## [1.0.2] - 2026-09-11

### Changed
- v1.0.2 — fix biometric unlock getting stuck; medication schedule frequency now scales to any dose count

## [1.0.1] - 2026-09-09

### Changed
- chore(deps): bump to 1.0.1 — update nodemailer, sharp

## [1.0.0] - 2026-09-06

First stable release. No functional changes since 1.0.0-rc.31 — the release candidate series is folded into this entry.

---

## [0.59.11] - 2026-09-06

### Changed
- chore(deps): bump to 0.59.11 — browserslist 4.28.9

## [0.59.10] - 2026-09-01

### Changed
- chore(deps): bump to 0.59.10 — next 16.3.4

## [0.59.9] - 2026-09-01

### Changed
- chore(deps): bump to 0.59.9 — next 16.3.3, otplib, eslint-config-next

## [0.59.8] - 2026-08-24

### Changed
- chore(deps): bump to 0.59.8 — update vitest

## [0.59.7] - 2026-08-22

### Changed
- Release v0.59.7 (early development; see git history).

## [0.59.6] - 2026-08-17

### Changed
- chore(release): bump to 0.59.6 — better-sqlite3-multiple-ciphers 13, next 16.3.1, minor/patch deps

## [0.59.5] - 2026-08-17

### Changed
- v0.59.5 — Dependabot EOVERRIDE fix

## [0.59.4] - 2026-08-14

### Changed
- chore(release): bump to 0.59.4 — nanoid vulnerability fix

## [0.59.3] - 2026-08-14

### Changed
- chore(release): bump to 0.59.3 — security header hardening

## [0.59.2] - 2026-08-14

### Changed
- 0.59.2 — observation timing, slot suppression, per-account app lock

## [0.59.1] - 2026-08-10

### Changed
- chore(deps): bump to 0.59.1 — update next, eslint-config-next, tsx, @types/better-sqlite3

## [0.59.0] - 2026-08-07

### Changed
- chore(release): bump to 0.59.0 — Code Quality dosing deepenings

## [0.58.10] - 2026-08-07

### Fixed
- Resolved npm audit vulnerabilities (postcss, brace-expansion, js-yaml) without an ESLint 10 upgrade; `THIRD-PARTY-NOTICES.md` regenerated.

---

## [0.58.9] - 2026-08-03

### Changed
- Bumped `read-excel-file`, `@types/react`, `@types/react-dom`.
- `npm audit fix` for brace-expansion DoS (GHSA-mh99-v99m-4gvg).
- Removed `docs/demo-staging-cutover.md` (cutover already complete).

---

## [0.58.8] - 2026-08-01

### Fixed
- Hard server-side row cap (2000) on records/observations GETs (including `fields=chart`) so long-lived families can't return unbounded result sets.

### Changed
- Medication dose-state now bulk-loads frequency rules, sibling-group membership, and rolling 24h totals in windowed queries instead of per-person × per-medication lookups, reducing an N+1 query pattern.

---

## [0.58.7] - 2026-08-01

### Changed
- ADR-0009: document that admin Entra instant-revoke bridges Graph poll lag; Entra remains source of truth and a later poll may restore `ok`.
- `fc-db-convert` accepts `FC_CONVERT_FROM_KEY` / `FC_CONVERT_TO_KEY` env vars so the host agent need not put keys on Docker argv.

---

## [0.58.6] - 2026-07-29

### Changed
- chore(deps): bump to 0.58.6 — next, react, react-dom, read-excel-file, eslint-config-next

## [0.58.5] - 2026-07-25

### Fixed
- Honour personal-link access when Entra groups are empty/unmapped: `requireRead()`, home/person pages, and push subscribe admit `hasAnyReadablePerson`.
- Person record/observation mutations and PRN reminder return opaque **404** (not 403) on unauthorised access.
- Rate-limit setup bootstrap (5 attempts / 15 min / IP) before bcrypt; proxy MFA enrollment DB failures redirect to login instead of failing open.

---

## [0.58.4] - 2026-07-25

### Fixed
- PRN reminder scheduling resolves weight from the latest Weight observation instead of non-existent `people.weight_kg`, so weight-banded frequency rules apply correctly.

---

## [0.58.3] - 2026-07-25

### Fixed
- Regenerate `THIRD-PARTY-NOTICES.md` after sharp 0.35.3 override so CI notices drift check passes.

### Changed
- AGENTS.md: explicitly forbid AI co-authorship trailers on commits and PRs.

---

## [0.58.2] - 2026-07-25

### Security
- Override `sharp` to `^0.35.3` to pick up patched libvips (CVE-2026-33327/33328/35590/35591); drop unused `serialize-javascript` and `uuid` overrides.

---

## [0.58.1] - 2026-07-25

### Fixed
- CI typecheck: Access Control unit tests use a plain env record instead of casting to `ProcessEnv`.

---

## [0.58.0] - 2026-07-25

Wave 6 — admin audit trail & overview.

### Added
- Administration → Audit Log (`/admin/audit-log`): paginated, filterable read-only viewer over `audit_log`.
- Administration → Access Control (`/admin/access-control`): read-only Entra group membership via Microsoft Graph.
- Structured `logger` lines for lifecycle, auth failures/lockouts, cron delivery errors, and security/admin `auditLog` mirrors so they reach the Admin container log stream.

### Changed
- Admin overview links Audit Log and Access Control; Database remains a permanent “Coming soon” placeholder.

---

## [0.57.0] - 2026-07-25

Wave 5 — file encryption & management.

### Added
- At-rest AES-256-GCM encryption for person photo uploads when `FC_ENCRYPTION_MODE` is `env` or `keyserver`, using a separate file key (`FC_FILE_KEY` / `FILE_WRAPPED_KEY`) with boot-time migration of plaintext files.
- Administration → Files (`/admin/files`): scan household uploads, show storage and orphan status, purge orphans.

### Fixed
- Replacing or clearing a person photo deletes the superseded on-disk file when nothing else references it.

---

## [0.56.0] - 2026-07-25

Wave 4 — observations catalogue.

### Changed
- Observation types are a curated catalogue only: managers can show/hide types (`is_active`); create and metadata edit are removed from the Management UI and API (ADR-0012).
- `POST /api/observation-type-config` returns 405; `PATCH` accepts `is_active` only; `DELETE` soft-deactivates rather than hard-deleting catalogue rows.

---

## [0.55.2] - 2026-07-24

### Changed
- chore(deps): bump to 0.55.2 — next 16.2.11, next-auth beta.32

## [0.55.1] - 2026-07-19

### Fixed
- System Settings: test-email result no longer leaks into every section — `RegistrySettingsPanel` reused a single shared error state for per-section save failures and the test-email result; the result now has its own state and save errors are scoped to the section that produced them.
- System Settings: added bottom padding so the last card (Outbound email / Send test email) isn't flush against the footer on mobile viewports.

---

## [0.55.0] - 2026-07-19

Wave 3 — architecture seams & code quality.

### Changed
- Hydration pacing, mute, and nudge evaluation share `evaluateHydration` / `createHydrationEvaluator` (dashboard + cron).
- Dashboard route orchestration collapsed into `evaluateDashboardPersonStatus`.
- Observation expectations last-at / next-due enrichment lives in `lib/observation-schedule.ts` (API, dashboard preload, cron).
- `user_settings` writes go through `writeUserSetting` with audit trail for user-initiated hydration config, mute, and timezone.

### Fixed
- Removed unused `getHydrationLastNudgeAt` / `getHydrationLastRecordAt`; documented `DB_PATH` and annotated `NEXTAUTH_URL` in `.env.local.example`.
- `package.json` overrides pin `nodemailer@^9` so `npm ci` succeeds without `--legacy-peer-deps` against next-auth’s optional peer range.

---

## [0.54.0] - 2026-07-19

Wave 2 — locale & settings audit.

### Added
- `locale.measurement_system` (`metric` \| `imperial`, default `metric`; env `FC_MEASUREMENT_SYSTEM`) — pre-selects units on the record-observation form; per-record override still allowed; values store literally.
- Display-layer unit conversion for charts, goals, and observation summaries (Weight, Height, Temperature, Blood Glucose, Hydration); history tables keep original entered value + unit.
- Managed instances: System Settings shows a read-only “Outbound email — Managed via environment” card with Graph configured status and Send test email.
- Medication dosage unit `applications` (creams/ointments) via shared `MEDICATION_DOSAGE_UNITS` constant across management, record, history, and import.

---

## [0.53.0] - 2026-07-19

Wave 1 — dosing status correctness and SMTP / re-auth security fixes.

### Fixed
- Record Medication dose-status panel now uses shared `evaluatePrnState` (same math as the dashboard), including `remindAfterHours` cooldown offsets and quantity-mode remaining-dose caps.
- Outbound / test-email failures no longer echo nodemailer transport banners; SMTP host settings reject cloud-metadata and link-local literals; test-email is rate-limited and audited.
- Password change and MFA setup/confirm/disable re-auth endpoints share the login rate limiter (keyed by local user) and audit failed password/OTP attempts.

---

## [0.52.0] - 2026-07-15

Wave 1 — security fixes and PWA icon touch-up.

### Fixed
- Entra session revoke (admin and Graph-detected disable) now prunes Web Push subscriptions; cron checks `auth_revalidation_status` (revoked + polled groups) before delivering PHI pushes.
- Entra JWT groups soft-refresh from polled `groups_json` so IdP demotions take effect without waiting for session expiry. See [ADR-0009](docs/adr/0009-entra-live-revocation.md).
- Self-service MFA disable blocked (and hidden in Profile) when `security.mfa_required` / managed hosting policy is active; admin `clear_mfa` recovery unchanged.
- Person photo IDOR via duplicate `photo_url`: serve requires read access to every owner; writes accept only well-formed upload URLs and reject cross-person reuse.
- PWA icon PNGs recolored to post-rebalance fc-blue `#256AA5`; manifest icon cache-bust query updated.

### Changed
- PRN cooldown / 24h caps remain **alerts only**, not dose-write gates (product won’t-fix). Documented in [ADR-0011](docs/adr/0011-prn-rules-are-alerts-not-write-gates.md), architecture, README, and write-path comments.

---

## [0.51.5] - 2026-07-15

### Changed
- chore(deps): bump to 0.51.5 — update tsx

## [0.51.4] - 2026-07-13

### Changed
- chore(deps): bump to 0.51.4 — read-excel-file, @types/node, eslint, @types/nodemailer

## [0.51.3] - 2026-07-12

### Changed
- v0.51.3 — surface demo version in footer

## [0.51.2] - 2026-07-12

Deploy-blocking regression from v0.51.1: containers crashed on every request with `Internal Server Error` / `The Proxy file "/proxy" must export a function named 'proxy' or a default function.`

### Fixed
- `proxy.ts` default export. The v0.51.1 fix switched `lib/auth.ts`'s NextAuth config to a config *function* (for per-request DB-backed Entra resolution), which changes `auth`'s shape: `auth(handler)` now resolves to a `Promise<Handler>` instead of a `Handler`, since next-auth wraps the whole thing in an outer `async` function when given a function config. `proxy.ts` called `auth(handler)` synchronously as its default export, so the export became a `Promise` rather than a function — failing Next.js's proxy-module function check on every request. Fixed with a top-level `await` to resolve the handler once at module init before exporting it.

## [0.51.1] - 2026-07-12

Correction to the v0.51.0 fix, found by re-checking the issue's own triage comment (which specified "Option 1: make the provider honour DB config") against what shipped (Option 2: gate the button on env-only). The v0.51.0 fix closed the immediate visible-but-broken-button bug but regressed the DB-only self-hosted Entra configuration capability the settings registry was built to support.

### Fixed
- Entra provider registration is now resolved per request from `lib/auth.ts`'s NextAuth config function (`resolveEntraCredentials`, env-first with DB fallback) instead of fixed at module load from env alone — implementing the triage-specified Option 1. A self-hoster who configures Entra purely through System Settings (no env vars at all) now gets working sign-in, not just a correctly-hidden button. See [ADR-0010](docs/adr/0010-entra-provider-request-scoped-config.md).
- `isEntraProviderActive` reverted the v0.51.0 change that additionally required the legacy `ENABLED_AUTH_PROVIDERS` env var — that was itself part of the wrong-direction (Option 2) fix.

## [0.51.0] - 2026-07-12

Wave 1 (post-replan) — quick fixes and dormant security-setting enforcement.

### Added
- `security.mfa_required` policy now enforced: mandatory on managed hosting; on self-hosted, forces TOTP enrolment only when enabled. Surfaced on Profile.
- `security.password_min_length` wired to real enforcement (server + client, replacing hardcoded `10`) with live "N more characters needed" validation on profile and setup password forms.
- Entra live revocation: hourly background Graph revalidation (`lib/auth-revalidation.ts`, piggybacked on the cron dispatcher) plus an admin-triggered instant revoke at `/admin/entra-sessions` with no Graph dependency. `ENTRA_SESSION_MAX_AGE_MINUTES` repurposed as a fail-safe bound rather than an unconditional forced re-login timer. See [ADR-0009](docs/adr/0009-entra-live-revocation.md).

### Fixed
- Entra sign-in: the login button and the actual NextAuth provider registration now share one source of truth (`isEntraProviderActive`, env-first with DB fallback), resolved per request in `lib/auth.ts` instead of fixed at module load from env alone. A self-hoster who configures Entra purely through System Settings (no env vars at all) now gets working sign-in, not a visible-but-broken button.
- PWA splash screen (`manifest.json`) `background_color` updated to the post-rebalance fc-blue (#256AA5).
- Dashboard PRN cooldown/at-cap/coverage-gap alerts show a "tomorrow" (or weekday) qualifier when the window-end time falls on a different local day, instead of an ambiguous bare `HH:mm`.

## [0.50.2] - 2026-07-10

### Changed
- chore: bump to 0.50.2 — sync third-party notices

## [0.50.1] - 2026-07-10

### Changed
- chore(deps): bump to 0.50.1 — update next, nodemailer, tailwind, vitest

## [0.50.0] - 2026-07-06

Form fields & labels (Wave 10) — FormField primitive and programmatic label association.

### Added
- `components/FormField.tsx` — shared label + `htmlFor`/`id` association for form controls.

### Fixed
- Management edit modals (people, medications, groups, observation types) use `FormField` for primary inputs.
- Profile password and MFA inputs have visible, associated labels.
- Profile per-person notification toggles use shared `Toggle` with focus ring.
- Record Observation BP fields use `<label htmlFor>` for Systolic/Diastolic.
- People edit modal: Entra unlink control has accessible name.
- `Toggle` and `ScheduleChipDismissButton` patterns: `Toggle` gains `focus-visible` outline; profile switches reuse `Toggle`.

## [0.49.9] - 2026-07-06

UX polish (Wave 9) — local users list clarity, goals tab spacing, schedule chip dismiss label.

### Fixed
- Local Users list shows role and reports access as separate fields (`Role: …` / `Can access reports` or `Cannot access reports`) instead of concatenated "Read Only + Reports".
- Goals tab Edit/Delete action row uses `gap-2` to match other management list rows.
- `ScheduleChipDismissButton` defaults `aria-label` to "Dismiss" with optional override.

## [0.49.8] - 2026-07-06

Charts a11y (Wave 8) — screen reader data access and named chart focus targets.

### Fixed
- History charts link to adjacent records tables via `aria-describedby`; tables gain stable ids and screen-reader captions.
- `LineChart` and `HydrationBarChart` SVGs use purposeful `aria-label`, `<desc>`, and `role="img"`.
- `LineChart` keyboard-focusable data points announce series, value, and date via `aria-label`.

## [0.49.7] - 2026-07-06

Typography scaling (Wave 7) — rem-based font sizes so user text-size preferences apply.

### Fixed
- Setup wizard step captions use `0.625rem` with relaxed line height instead of fixed `10px`.
- Import preview table cells use `0.6875rem` instead of fixed `11px`.
- Line chart and hydration bar chart SVG axis, legend, and goal-line labels use shared rem constants (`0.75rem` / `0.8125rem`) instead of fixed pixel `fontSize`.

## [0.49.6] - 2026-07-06

Site chrome & navigation a11y (Wave 6) — pinch-zoom, landmarks, skip link, sticky management Add buttons.

### Fixed
- Removed `maximumScale` and `userScalable: false` from root viewport metadata so users can pinch-zoom (WCAG 1.4.4 / 1.4.10).
- Hamburger menu and dropdown links wrapped in `<nav aria-label="Primary">`.
- Skip-to-content link as first focusable element in the document; activates focus on `<main id="main-content">` across all pages.
- Sticky "+ Add" button on medications (Medications and Groups tabs), people, and observation-types management lists so the primary action stays reachable on long catalogues.

## [0.49.5] - 2026-07-06

Alert deduplication (Wave 5) — duplicate dashboard alerts per medication/observation collapsed to one.

### Fixed
- `dedupeIssuesBySubject()` collapses multiple dashboard issues for the same `medicationId`/`observationType` (e.g. `prescription_overdue` + `prescription_upcoming`, or `prn_at_cap` + `prn_cooldown` for the same medication) into a single alert — the highest-priority issue wins via `compareDashboardIssues`. Called after `suppressScheduledWhenPrnBlocked` in `app/api/dashboard/route.ts`.
- Confirmed the person-hub alert card's worst-of-all-rows border accent is intentional behaviour, not a bug; documented at `components/PersonPageActions.tsx`.

## [0.49.4] - 2026-07-06

### Changed
- v0.49.4 - Wave 4: pluralisation helper + save/copy hygiene

## [0.49.3] - 2026-07-06

Modal primitive + medication UI (Wave 3) — shared accessible Modal, nested-modal fix, group rule-creation removal.

### Added
- `components/Modal.tsx`: canonical shared dialog primitive — `role="dialog"`, `aria-modal`, `aria-labelledby` wired to a `title` prop, a Tab focus trap, and focus restoration to whatever was focused before opening. Exposes a `useFocusTrap` hook for non-portal cases. Nested `Modal` instances stack correctly — only the topmost dialog responds to Escape/Tab.

### Fixed
- `ConfirmModal` refactored onto the new `Modal` primitive (external API unchanged) so it also benefits from the shared focus-trap/return-focus behaviour.
- "Edit Family Member" (Manage People), "Edit Medication", and "Edit Group" modals now use the shared `Modal` — proper dialog semantics, focus trap, return focus, and `aria-labelledby`.
- Edit Medication → Edit rule: the inline rule sub-form is now a real nested `Modal` stacked on top of the parent dialog instead of an inline `<div>`, fixing a button-collision layout bug and a focus-loss bug on Cancel/Save.
- `AppLockOverlay` (biometric lock screen) now exposes `role="dialog"`, `aria-modal`, and an `aria-labelledby` hidden title, with a focus trap while locked.
- Removed group-level medication frequency-rule creation UI from the Groups tab — group-scoped rules were already documented as not enforced and never evaluated at runtime. Migration `014_remove_group_frequency_rules` deletes existing group-scoped rows; the API rejects `medication_group_id` on rule creation.

### Removed
- `app/api/medication-frequency-rules` routes (top-level GET/POST and `[id]` PUT/DELETE) — only ever used by the now-removed group rule-creation UI.

## [0.49.2] - 2026-07-06

Colour + contrast (Wave 2) — fc-blue token rebalance and dependent WCAG AA contrast fixes.

### Fixed
- `app/globals.css`: rebalanced `--color-fc-blue` (#2B7DC2→#256AA5), `--color-fc-blue-mid` (#1E6BAD→#1A5F96), `--color-fc-blue-dark` (#155490→#124F7A) so full-opacity white text meets AA against the base canvas colour; replaced hardcoded `#2B7DC2` literals across the app with the new token value.
- Systemic `text-white/NN` opacity contrast failures replaced with full-opacity `text-white` across history, setup, admin overview, RegistrySettingsPanel, PersonPageActions, HomePeopleList, GettingStartedCard, medications, local-users, LoginForm, and EntityRowActions; compounding `text-xs` instances bumped to `text-sm`/larger, including chart legend and axis labels in `LineChart.tsx`/`HydrationBarChart.tsx`.
- Goals tab Edit link contrast fixed as part of the shared `entityRowEditButtonClass` fix.
- "+ Add Local User", "+ Add Medication", "+ Add Group", "+ Add Family Member", "+ Add Observation Type" buttons switched from a translucent `bg-white/20` fill (failed AA on the plain `fc-blue` canvas, and read as disabled) to a solid `bg-white`/`text-fc-blue` primary-CTA treatment consistent with existing primary buttons elsewhere in the app.
- Inactive medication row Edit link: removed the blanket `opacity-60` container class that was multiplying already-fixed text contrast back down below AA; inactive state is still conveyed via the existing "Inactive" badge.
- Login input placeholder text now renders at full opacity.
- Medication and group notes: removed single-line `truncate` clipping (now wraps) so clinically relevant dosing/administration text is never hidden, and bumped to `text-sm`.
- Login and setup wizard inputs: added a visible `focus-visible` ring in addition to the existing border-opacity change, so keyboard focus is clearly indicated.

### Investigated
- `EntityRowActions` Edit-link contrast variance across screens: confirmed all affected screens use the identical shared `entityRowEditButtonClass`/`EntityRowEditButton`; the perceived difference in legibility traced to `text-white/70` rendering differently over the lighter `fc-blue` canvas vs. the darker `fc-blue-dark` admin surface, not a per-screen styling divergence. Resolved as a side effect of the earlier text-white opacity contrast sweep (shared class now uses full-opacity white, which passes AA on both surfaces).

## [0.49.1] - 2026-07-06

Security follow-up (run 8) — ZAP baseline run 2, post-Wave-1 residual findings.

### Fixed
- CSP: added `base-uri 'self'`, `form-action 'self'`, `object-src 'none'` to `lib/security-headers.ts` — these directives never inherit from `default-src` per spec and were previously unrestricted (ZAP 10055).
- `next.config.ts` `headers()`: `/_next/static/:path*` now carries `X-Content-Type-Options` and `Permissions-Policy` (proxy matcher and prior header coverage both excluded static asset chunks); `/manifest.json` now sets `Cache-Control: public, max-age=3600` (ZAP 10021/10063/10015).

### Documentation
- Filed and closed 7 wontfix/accepted-risk issues recording rationale for residual ZAP WARNs (callbackUrl RSC-payload false positive, Auth.js-owned session cache headers, empty-body redirect Content-Type, Cloudflare edge/challenge-platform noise, browser-only Sec-Fetch-Dest, and informational findings) so future scans can be diffed against a known-accepted baseline.

## [0.49.0] - 2026-07-06

Security follow-up (run 7) — ZAP baseline hardening: callbackUrl, cookie Secure flag, header coverage, CSP consistency.

### Fixed
- `lib/safe-callback-url.ts` — shared `safeRelativeCallbackUrl()` allow-lists same-origin relative paths only, rejecting protocol-relative (`//evil.com`) and backslash (`/\evil.com`) open-redirect bypasses; used by `LoginForm` and as an Auth.js `redirect` callback in `lib/auth.ts` (ZAP 10031).
- `nextAuthUseSecureCookies()` decoupled from `BEHIND_REVERSE_PROXY` — Auth.js cookies are now `Secure` whenever the app isn't running under `next dev`, since the flag is evaluated on the browser-facing HTTPS hop regardless of proxy placement (ZAP 10011).
- Security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`, `Content-Security-Policy`) extracted to `lib/security-headers.ts` and now also applied via `next.config.ts` `headers()` on `/login`, `/denied`, `/manifest.json` — routes the proxy matcher excludes but that scanners can still reach directly.

### Documentation
- ADR-0007 and README updated: `NEXTAUTH_USE_SECURE_COOKIES` no longer affects the cookie `Secure` flag.

## [0.48.3] - 2026-07-05

### Fixed
- fix: Healthy log ingest companion (5m heartbeat)

## [0.48.2] - 2026-07-05

### Fixed
- fix(ops): Healthy log visible to Admin ingest

## [0.48.1] - 2026-07-05

### Changed
- Wave 11: allowScripts + Healthy boot log

## [0.48.0] - 2026-07-04

Structured JSON logger for admin container-log ingestion (Wave 9).

### Added
- `lib/logger.ts` — machine-readable `{ ts, level, msg }` lines on stdout/stderr.
- Replaced `console.*` in `lib/` and `app/api/` with `logger.*` so admin can classify levels.

## [0.47.0] - 2026-07-04

Notification history — per-recipient log at send time and Profile History UI.

### Added
- `notification_log` table (migration `013_notification_log`) written at send time — one row per distinct recipient, not per device.
- Consolidated push dispatch: `resolveSubscribersForPerson`, `sendAndLogPush`, `dispatchPersonPush`; acknowledgement pushes now apply `pushSubscriberStillAuthorised`.
- `GET /api/me/notification-log` with records-style keyset pagination.
- Profile → Notifications **History** sub-tab with load-more pagination.

### Changed
- Preferences remain the default Notifications sub-tab; switching preserves in-memory preference toggles.

## [0.46.3] - 2026-07-04

Patch — strip trailing whitespace in embedded licence texts for CI drift check.

### Fixed
- Notices generator strips per-line trailing whitespace so CI and local `THIRD-PARTY-NOTICES.md` match.

## [0.46.2] - 2026-07-04

Patch — normalise licence newlines in third-party notices for CI.

### Fixed
- Notices generator normalises CRLF in embedded licence texts and pins `THIRD-PARTY-NOTICES.md` to LF via `.gitattributes`.

## [0.46.1] - 2026-07-04

Patch — platform-stable third-party notices generator for CI drift check.

### Fixed
- Notices generator resolves hoisted package paths and uses lock-only metadata for optional platform deps so CI `git diff` matches committed `THIRD-PARTY-NOTICES.md`.

## [0.46.0] - 2026-07-04

Security follow-up (run 6), licensing, AppHeader, and push prune.

### Fixed
- Settings write path rejects `platformLocked` keys under managed profile before DB/audit (`403 Managed by platform`).
- VAPID config writes go through shared `writeAppSettingValue`.
- Push sender prunes `410`/`404` endpoints and logs failures as messages, not full `WebPushError` objects.
- Import mobile gate renders `AppHeader` so users can navigate without a back gesture.

### Changed
- `AppHeader` is session-aware: minimal chrome on login/setup/lock; menu + quick record on all signed-in pages; `backHref` removed (person-bar back only).
- Boot fails closed when `DB_KEY_SERVER_URL` is not `https://` in keyserver mode.
- Removed orphaned `/api/local-login/precheck` route and proxy exclusion.

### Documentation
- Setup-phase `/api/setup/*` proxy exclusion documented (architecture + ADR-0002).
- CSP `unsafe-inline`/`unsafe-eval` retained with investigation note.
- `THIRD-PARTY-NOTICES.md` attributes `better-sqlite3-multiple-ciphers` / SQLCipher; generator is date-stable and gated in CI.
- Encryption runbook: pre-convert `.env` expectation and HTTPS keyserver URL.

## [0.45.3] - 2026-07-03

### Changed
- chore(deps): bump to 0.45.3 — nodemailer 7.0.13 -> 9.0.1 (fixes CRLF injection/SSRF vulns)

## [0.45.2] - 2026-07-03

Patch — bundle `fc-db-convert` CLI in production Docker image.

### Fixed
- Standalone images now ship `/app/fc-db-convert.cjs` so managed-hosting instance conversion works without `tsx` or dev `scripts/` tree.

## [0.45.1] - 2026-07-03

Patch — fix Docker standalone missing SQLCipher native binding.

### Fixed
- `next.config.ts` `serverExternalPackages` now lists `better-sqlite3-multiple-ciphers` (was `better-sqlite3`), so the `.node` binding is included in standalone Docker images. v0.45.0 images failed at boot with `Could not locate the bindings file`.

## [0.45.0] - 2026-07-03

### Changed
- Wave 7: encryption at rest, MFA fix, conversion tooling

## [0.44.4] - 2026-07-03

Patch — managed outbound email via Microsoft Graph.

### Added
- `lib/graph-mail.ts` and `lib/email-send.ts` — managed instances send mail via Graph (client credentials); self-host unchanged (SMTP).

### Changed
- `email.available` on managed requires provisioned `FC_GRAPH_MAIL_*` creds (no longer unconditionally true).
- Test email route uses unified outbound sender.

### Documentation
- ADR-0004/0006 updated for Graph mail on managed profile.

## [0.44.3] - 2026-07-03

Patch — hide managed SMTP settings from tenant admin UI.

### Changed
- SMTP registry entries are `platformLocked` under managed profile so outbound email stays platform-provisioned.

### Fixed
- Setup wizard SSO path uses Next.js `Link` for local-credentials sign-in (lint).

## [0.44.2] - 2026-07-03

Patch — fix GHCR publish tags in parallel build jobs.

### Fixed
- Per-arch Docker build jobs use lowercase `ghcr.io/${GITHUB_REPOSITORY,,}` (0.44.1 parallel publish failed with mixed-case repo name).

## [0.44.1] - 2026-07-03

Patch — audit log health-data redaction and faster CI publish.

### Fixed
- Observation and medication-record UPDATE audits no longer duplicate clinical values (`value`, `unit`, `dosage`) in `audit_log` details.

### Changed
- GHCR publish runs `linux/amd64` and `linux/arm64` builds in parallel, then merges manifests — amd64 images are no longer blocked by arm64 emulation build time.

### Documentation
- [ADR-0008](docs/adr/0008-audit-log-coverage.md) — audit log invariant and auth/security event inventory.

## [0.44.0] - 2026-07-03

Wave 6 (dev) — settings registry, setup wizard, reverse-proxy mode.

### Added
- Typed settings registry expansion: Entra auth block, security policy, SMTP, VAPID push keys with env-wins precedence and admin UI generated from registry.
- Registry-backed Admin → System Settings panel with secret masking, group env-lock, and managed `platformLocked` hiding.
- `email.available` derived flag and SMTP test email to current admin.
- Self-host VAPID auto-generation and registry resolution.
- Two-stage setup wizard: account/person/timezone/SMTP (self-host) or person/timezone (managed); Entra SSO finish path.
- `BEHIND_REVERSE_PROXY` unified toggle with retained `TRUST_PROXY_DEPTH`; local credentials provider always on.
- [ADR-0006](docs/adr/0006-environment-variable-inventory.md) env inventory and [ADR-0007](docs/adr/0007-reverse-proxy-mode.md) reverse-proxy mode.

### Changed
- Setup status API and wizard context drive variable steps; MFA enrollment redirects to Profile → Account tab.
- Local dev uses webpack bundler (`npm run dev`) with `better-sqlite3` postinstall rebuild for native module compatibility.

### Fixed
- Setup page surfaces API failures instead of infinite loading; health route logs DB errors.

## [0.43.0] - 2026-07-03

Wave 5 — demo image unification (guard, profanity filter, seed sync).

### Added
- `FC_PLATFORM_PROFILE=demo` + `DEMO_MODE=true` platform guard — demo behaviour (OTP bypass, account blocks, profanity filter) arms only in platform demo context; self-host ignores `DEMO_MODE`; misconfigured platform env fails fast at boot.
- Reject-on-write profanity filter on enumerated API write paths when demo mode is armed; hybrid local blocklist + purgomalum API (demo only, 1s timeout, fail-open).
- [`docs/demo-staging-cutover.md`](docs/demo-staging-cutover.md) staging checklist before public demo cutover.
- [ADR-0005](docs/adr/0005-demo-mode-platform-guard.md) — demo guard and moderation decisions.

### Changed
- All prior `DEMO_MODE` checks use `isDemoModeActive()` (`lib/demo-mode.ts`).

## [0.42.0] - 2026-07-02

Wave 4 — PWA deploy freshness, changelog backfill, multi-arch CI.

### Added
- `GET /api/version` — unauthenticated deploy version probe (`Cache-Control: no-store`).
- `DeployRefresh` client component polls `/api/version` on load and tab focus; reloads when the server version differs from the baked bundle so What's New and footer version stay aligned after deploy.
- `scripts/backfill-changelog-from-tags.mjs` — regenerates skeleton CHANGELOG entries from annotated git tags.

### Changed
- GHCR publish workflow builds `linux/amd64` and `linux/arm64` images.
- `CHANGELOG.md` backfilled for all tagged releases (pre-0.14.0 skeleton + 0.34.5–current gap fill); historical notes document omitted 0.29.3–0.29.9.

## [0.41.0] - 2026-07-02

Wave 3 — medication dosing (rules & API).

### Added
- Medication schedule window settings in the typed `app_settings` registry (`schedule.lead_minutes`, `schedule.overdue_offset_minutes`, `schedule.slot_association_radius_minutes`) with Admin → System Settings UI and optional `FC_SCHEDULE_*` env overrides.
- `lib/schedule-config.ts` — single seam loading three caregiver-tunable knobs and deriving evaluator/history timing from a fixed 30-minute push-delivery width.
- Cursor pagination for `GET /api/records` (`{ rows, nextCursor }` when `limit` is set); history medication tab loads additional pages.

### Changed
- Default overdue push offset is now 30 minutes after nominal slot time (was 2 hours via `PUSH_OVERDUE_HOURS`). Legacy `PUSH_OVERDUE_HOURS` still honoured when `FC_SCHEDULE_OVERDUE_OFFSET_MINUTES` is unset.

## [0.40.5] - 2026-07-02

### Fixed
- Unwind cached Management > Medications redirect so the route no longer 404s when the browser cached the legacy 308.

## [0.40.4] - 2026-07-02

Wave 2 — application security hardening (run 4).

### Security
- MFA second factor cannot be re-enrolled by a session-only attacker without password + existing TOTP.
- Push subscriptions pruned when a local user is deactivated or downgraded; cron re-checks person access before send.
- Client-controlled `remind_after_hours` clamped to medication min-interval and sensible bounds.
- `/api/health` no longer discloses server data-directory path.

## [0.40.3] - 2026-06-27

### Changed
- chore: release 0.40.3

## [0.40.2] - 2026-06-27

### Changed
- Merged branch WheelieLabs/claude/medication-save-failure-q4niey

## [0.40.1] - 2026-06-27

### Changed
- Merged branch WheelieLabs/claude/push-notifications-broken-61irlv

## [0.40.0] - 2026-06-26

Wave 1 — medication dosing-alert correctness.

### Fixed
- Recording a dose for a scheduled medication clears the scheduled/overdue dashboard alert again (restores proximity clearance removed in 0.37.8).
- Record Medication deep-link prefills the scheduled slot dosage (`scheduledDosage` in `action_url`).
- Record Medication API returns medications for personal-link users; search and deep-link prefill.
- Stop evaluating group-scoped frequency rules against sibling group members.

## [0.39.4] - 2026-06-26

### Changed
- Revoked or expired sessions now return the user to the login page instead of an "Access Denied" screen. The `jwt` callback returns `null` on local-user revocation (`session_version`/`is_active`) or Entra absolute-lifetime lapse, so Auth.js clears the session cookie and the existing `redirect("/login")` guards fire — no more manual sign-out to recover.
- Lengthened the default Entra absolute session lifetime from 60 minutes to 480 (8 hours) via `ENTRA_SESSION_MAX_AGE_MINUTES`, covering a normal working day while still forcing periodic re-auth (and group/account re-read) for offboarded accounts.

### Fixed
- Stop clearing the device-bound biometric app-lock credential on sign-out, so users no longer re-enrol Face ID / Touch ID on every login. The credential is device-scoped and gated by the platform authenticator, not an account secret.

## [0.39.3] - 2026-06-26

Wave 1 application security hardening (run 3) — residual MEDIUM/LOW findings from local security audit run 3.

### Security
- Reject a medication-record `dosage_unit` that does not match the catalogue unit case-insensitively (previously stored verbatim), closing the residual 24h quantity-cap bypass where a genuinely different unit (e.g. `mgs` vs `mg`) was excluded from the unit-scoped cap sum.
- Require an active `person_medications` link (and enforce the medication's `min_age_years`/`max_age_years` against the person's date of birth) when recording a dose via `POST`/`PATCH /api/records`; the spreadsheet import enforces the age bounds and assigns the medication to the person rather than requiring a pre-existing link.
- Gate global medication catalogue creation in `POST /api/import/confirm` behind the global readwrite+ role: a personal-link / read-only writer may import only against existing medications, and a row that fails validation no longer leaves an orphan catalogue entry.
- Restrict the hydration settings merge and bucket resolution to a person's own personal-link account (`people.user_uid`): a read-only caregiver who merely watches a person can no longer inject pacing settings to suppress the shared "behind on hydration" reminder across dashboards and cron.
- Close the unauthenticated `/api/setup/bootstrap` window on mixed Entra+credentials instances: persist an `admin_seen` sentinel on the first admin-group Entra sign-in so bootstrap is refused once an admin has authenticated, and create the first admin under a `BEGIN IMMEDIATE` transaction so concurrent POSTs cannot both create an admin.

## [0.39.2] - 2026-06-26

Wave 1 application security hardening (run 2) — residual MEDIUM/LOW findings from local security audit run 2.

### Security
- Validate and normalise the medication-records write path (POST/PATCH + spreadsheet import): require positive in-range `dosage`, bound `recorded_at` (no future beyond skew / implausibly old), normalise `dosage_unit` to the catalogue unit, and reject inactive medications — closes 24h-cap / cooldown safety-signal corruption.
- Authorise per-person read access before creating a `person_notification_prefs` subscription on `POST /api/push/subscribe`, fixing an IDOR that delivered another person's medication reminders.
- Derive the auth rate-limiter client IP from the trusted reverse-proxy hop (`TRUST_PROXY_DEPTH`, default 1) instead of the spoofable first `X-Forwarded-For` entry, and add an IP-independent per-email failure cap.
- Retire the boot-time `migrateAccountIdentity()` reconciliation: a planted notification-pref watcher could be promoted to `people.user_uid` owner. Removed `FC_ACCOUNT_IDENTITY_MIGRATION` and the promotion path; runtime hydration/push identity resolution is unchanged.
- Enforce an absolute Entra session lifetime (`ENTRA_SESSION_MAX_AGE_MINUTES`, default 60) so a disabled/de-grouped Azure account is forced to re-authenticate rather than retaining groups until JWT expiry.
- Route `PUT /api/observations/[id]` and the spreadsheet-import weight / BP-pair side-effect inserts through `validateObservationWrite`.
- Serve uploaded photos default-deny: drop `is_active = 1` from the owner lookup so deactivated owners still gate, and 404 when no owning person row matches.

### Removed
- `FC_ACCOUNT_IDENTITY_MIGRATION` environment variable and `lib/account-identity-migration.ts`.

## [0.39.1] - 2026-06-26

### Fixed
- CI typecheck: use `vi.stubEnv` in `auth-secret` tests (`NODE_ENV` is read-only in CI).

## [0.39.0] - 2026-06-26

Wave 1 application security hardening (includes planned 0.38.1 hotfixes).

### Security
- Reject missing, placeholder, or short `NEXTAUTH_SECRET` at boot in production; removed live default from `docker-compose.yml`.
- Gate `/api/setup/bootstrap` behind credentials provider + atomic first-admin insert; refuse under `FC_PLATFORM_PROFILE=managed`.
- Hybrid session revocation for local users: per-request role/`is_active` re-derive plus `session_version` bump on password/MFA/role changes.
- Rate-limit auth paths; neutralise MFA-independent password oracle on `/api/local-login/precheck`.
- Validate Web Push subscription endpoints (HTTPS allowlist, private-IP rejection, connect-time agent + timeout).
- Validate observation writes and spreadsheet import against active `observation_type_config`.
- Per-person ACL on uploaded photo serve; CSPRNG filenames.
- Fail closed on `/api/cron` when `CRON_SECRET` unset or `CRON_MODE=internal`; constant-time secret compare.
- Narrow MFA-enrollment API allowlist (exclude `/api/people` and `/api/upload`).
- Cap `/api/import/confirm` row count.
- Disable non-convergent `migrateAccountIdentity()` at boot unless `FC_ACCOUNT_IDENTITY_MIGRATION=true`.
- Filter foreign caregiver accounts from hydration settings read merge.

### Fixed
- Removed legacy `/:personId/medications` redirects that captured `/management/medications`.
- Defensive `parseScheduleTimes` for malformed `schedule_times` JSON.

### Changed
- `GET /api/observations` uses `authorisePersonAccess` for per-person read ACL.

## [0.38.0] - 2026-06-24

### Changed
- Introduced `authorisePersonAccess(db, ctx, personId, mode)` in `lib/auth-helpers.ts` — a single seam that loads a person by id, verifies read or write access (RBAC + personal-link), and returns the `Person` row or a 404 response. Replaces 20+ independent person-load + `canReadForPerson`/`canWriteForPerson` blocks across 8 routes. All unauthorised access now consistently returns 404 (previously some routes returned 403), preventing caller probing of person existence.
- Converted `observation-goals` POST and DELETE from raw `auth()` calls to `requireAuth()` for consistency with the rest of the route module pattern.
- Removed local `getPerson` helper from `people/[id]/person-medications/route.ts` (superseded by the shared seam).

## [0.37.9] - 2026-06-24

### Added
- Custom 404 page (`app/not-found.tsx`) matching the app theme — `bg-fc-blue` canvas, AppHeader/AppFooter, Go Home button.

## [0.37.8] - 2026-06-24

### Changed
- Introduced `lib/schedule-slot-evaluator.ts`: a pure-function module (`evaluateScheduledSlot`, `resolveSlotMs`, `defaultSlotEvaluatorConfig`) that replaces independent slot classification logic that previously existed in both dashboard and cron. Both callers now import the shared evaluator; slot status (`"upcoming" | "due" | "overdue" | "overdue_push" | "suppressed" | "inactive"`) is computed identically in both contexts.
- Removed proximity-based dose suppression (silent skip when a dose was recorded near the slot time) from dashboard and cron. Replaced with opt-in suppression: when recording a dose, users can tick "Cancel the [time] reminder" to suppress the next scheduled slot for that medication. The suppression is written to a new `schedule_reminder_suppressions` table (`person_medication_id`, `local_ymd`, `slot_hhmm`).
- `lib/cron.ts`: `runScheduledReminders` now bulk-preloads suppressions and uses `evaluateScheduledSlot`. Added `cleanupScheduleSuppressions` (removes rows older than 3 days) called at the top of each cron run.
- `lib/dashboard-issue-builders.ts`: `loadDashboardPreload` loads per-row `CalendarContext` and the suppression table; `buildScheduledMedicationIssues` uses `evaluateScheduledSlot`. `SCHEDULE_GRACE_MS` extended to 150 min (was 120 min) to cover the overdue push window, keeping the dashboard red while a push fires.
- `lib/cron-reminder-predicates.ts`: removed `scheduledReminderKind` and `SLOT_WINDOW_MS` (superseded by the evaluator module).
- `app/api/records/route.ts`: POST now accepts `suppressNextSlot: boolean`; when true, finds the first scheduled slot after the recorded dose time and inserts a suppression row.
- `app/api/medications/route.ts`: both person-scoped query paths now return `person_medication_id`, `schedule_times`, `schedule_frequency`, `schedule_start_date`, `schedule_end_date`.
- `app/[personId]/record-medication/page.tsx`: shows a "Cancel the [time] reminder" checkbox when the selected medication has a scheduled slot later today; the checkbox state is sent as `suppressNextSlot` in the POST body.
- Vitest coverage added for `schedule-slot-evaluator.ts` (22 tests: inactive windows, all status paths, configurable windows, IANA vs UTC-offset slot resolution).

## [0.37.7] - 2026-06-24

### Changed
- Centralised PRN dose state into `lib/medication-dose-state.ts` (`loadMedicationDoseState` + `evaluatePrnState`). Dashboard preload, medications API, and cron are now callers rather than each running independent rule lookups and 24h-total queries. Cron's `runPrnReminders` now also respects the 24h cap before sending a push (previously it only checked the minimum interval). Deleted `lib/person-medication-status.ts` (N+1 loader replaced by the bulk module). Vitest coverage added for both the loader and the evaluator.

## [0.37.6-p1] - 2026-06-24

### Fixed
- fix: calendar-context test UTC timezone

## [0.37.6] - 2026-06-24

### Changed
- Introduced `resolveCalendarContext` (precedence: row IANA → instance IANA → client offset headers) replacing `resolveScheduleContextFromRequest` + `resolveInstanceTimezone` pairs across all schedule-aware routes and cron. The precedence logic now lives in one module (`lib/calendar-context.ts`) rather than being re-derived at each call site.

---

## [0.37.5] - 2026-06-24

### Fixed
- Account-identity migration no longer treats caregiver/watcher uids in `person_notification_prefs` as stale aliases of watched people, which rekeyed push endpoints, vacuumed `user_settings`, merged notification prefs, and moved favourites on every container start.
- Partial `user_settings` merge deletes only migrated keys from the source uid (e.g. `locale.timezone` is no longer dropped when hydration keys merge).
- `resolveHydrationSettingsUid` ignores foreign watcher uids and picks a stable push uid when `last_used` is tied.

---

## [0.37.4] - 2026-06-24

### Fixed
- Account-identity migration no longer reverse-merges `user_settings` from the canonical push uid onto legacy `people.user_uid`, which deleted hydration pacing, timezone, and other per-user settings on every container start.
- Photo uploads use the same data directory as the SQLite database (`getDataDir()`).
- Docker Compose volume mount aligned to `/app/data` (default `DB_PATH`).

---

## [0.37.3] - 2026-06-24

### Fixed
- Hydration pacing settings no longer reset to defaults after restart when linked to a Microsoft or push account with legacy identity rows.

---

## [0.37.2] - 2026-06-24

### Changed
- User-facing What's New notes moved to `WHATS_NEW.md`; `CHANGELOG.md` is maintainer-only again.
- Build reads `WHATS_NEW.md` for the in-app modal; removed developer-focused 0.37.0 highlights from user notifications.

---

## [0.37.1] - 2026-06-24

### Fixed
- CI typecheck regenerates `lib/changelog.generated.json` via `pretypecheck` after the artefact was gitignored.

---

## [0.37.0] - 2026-06-24

### Added
- `serverExternalPackages: ["web-push"]` silences DEP0169 `url.parse` warnings in standalone images.
- Tests for `getApplicableFrequencyRule`, observation goals, favourites, `build-changelog.mjs`, and `/api/whats-new`.
- Runtime request-body validation for local user and setup bootstrap APIs.

### Changed
- Favourites create form resets downstream state in event handlers instead of cascading `useEffect`s.
- `lib/changelog.generated.json` is a build artefact only — gitignored and removed from version control.

---

## [0.36.29] - 2026-06-24

### Changed
- patch: 2026-06-24: Codebase cleanup

## [0.36.28] - 2026-06-24

### Changed
- patch: 2026-06-24: Hydration pacing setting clobber bug

## [0.36.27] - 2026-06-24

### Changed
- patch: 2026-06-24: Wave 1 Test fixes

## [0.36.26] - 2026-06-24

### Fixed
- History end-date defaults no longer go stale across midnight on long-lived tabs.
- Date-tab range queries use local calendar bounds when client schedule headers are sent.
- Blood Pressure observation summary returns paired systolic/diastolic without a second client fetch.
- Invalid `schedule_tz` / observation expectation timezone values are nulled on startup.
- 24h medication cap totals are form-local, not aggregated across group siblings.
- Push ack suppression, unsubscribe, and hydration reminders tolerate legacy Entra `sub`-keyed rows.
- Orphaned `user_uid` rows in push_endpoints, prefs, favourites, and user_app_state are reconciled on startup.

---

## [0.36.23] - 2026-06-23

### Changed
- patch: 2026-06-23 PR5b Hydration Layer C push mute

## [0.36.22] - 2026-06-23

### Changed
- patch: 2026-06-23 PR5a Hydration Layer C core

## [0.36.21] - 2026-06-23

### Changed
- patch: 2026-06-23 PR4b SW notify actions

## [0.36.20] - 2026-06-23

### Changed
- patch: 2026-06-23 PR4a Per-user timezone

## [0.36.19] - 2026-06-23

### Changed
- patch: 2026-06-23 PR3 canonicalAccountUid + migration

## [0.36.18] - 2026-06-23

### Changed
- patch: 2026-06-23 PR2 UNIQUE people.user_uid

## [0.36.17] - 2026-06-23

### Changed
- patch: 2026-06-23 PR1 atomic config + HydrationTzSource trim

## [0.36.16] - 2026-06-23

### Fixed
- hotfix v0.36.16 (greedy redirects + AppLock regression)

## [0.36.15] - 2026-06-22

### Changed
- patch: issues update (comments only) plus publish.yml changes

## [0.36.14] - 2026-06-22

### Fixed
- patch: fix(timezone): complete remaining cluster

## [0.36.13] - 2026-06-22

### Changed
- patch: timezone fixes

## [0.36.12] - 2026-06-22

### Changed
- patch: timezone fixes

## [0.36.11] - 2026-06-22

### Changed
- patch: fix import tests

## [0.36.10] - 2026-06-22

### Changed
- patch: hydration cron DST day-boundary fix

## [0.36.9] - 2026-06-22

### Changed
- patch: replace exceljs due to unpatched deps

## [0.36.8] - 2026-06-22

### Changed
- patch: date handling cleanup and BP enrinchment failure handling

## [0.36.7] - 2026-06-22

### Changed
- patch: codebase cleanup

## [0.36.6] - 2026-06-20

### Changed
- patch: hydration goal pacing notifications

## [0.36.5] - 2026-06-20

### Changed
- patch: hydration goal pacing dependency notification deep linking fix

## [0.36.4] - 2026-06-20

### Changed
- patch: hydration goal pacing dependency tz fixes part 2 and test fixes

## [0.36.3] - 2026-06-20

### Changed
- patch: hydration goal pacing dependency tz fixes part 1

## [0.36.2] - 2026-06-20

### Changed
- patch: hydration goal pacing part 2 (pacing logic)

## [0.36.1] - 2026-06-20

### Changed
- patch: adjust hydration goal tests to be logic only, no db

## [0.36.0] - 2026-06-20

### Added
- feat: hydration goal pacing part 1 (UI changes only)

## [0.35.5] - 2026-06-20

### Changed
- patch: adjust BP summary in observation history (readings count)

## [0.35.4] - 2026-06-20

### Changed
- patch: adjust BP summary in observation history

## [0.35.3] - 2026-06-20

### Changed
- chore(deps): bump to 0.35.3 — update better-sqlite3@12.11.1 vitest@4.1.9

## [0.35.2] - 2026-06-20

### Changed
- chore(deps): bump to 0.35.2 — update better-sqlite3@12.10.1 next@16.2.9 tailwindcss@4.3.1 tmp@0.2.7

## [0.35.1] - 2026-06-08

### Changed
- patch: What's New capability bug fix

## [0.35.0] - 2026-06-08

### Added
- feat: What's New capability

## [0.34.4] - 2026-06-08

### Added
- Favourites feature with per-user, per-person saved actions.
- User interface for reordering and managing favourite actions.

### Fixed
- Entra ID authentication issue.

---

## [0.34.3] - 2026-06-08

### Changed
- patch: EntraID auth troubleshooting

## [0.34.2] - 2026-06-08

### Changed
- patch: adjust user interface for favourites

## [0.34.1] - 2026-06-08

### Changed
- patch: add user interface for favourites

## [0.34.0] - 2026-06-08

### Added
- feat: introduce favourites

## [0.33.2] - 2026-06-08

### Fixed
- App lock reliability improvements.
- Timezone handling for the hydration panel.

---

## [0.33.1] - 2026-06-08

### Changed
- patch: remove hydration custom amount button

## [0.33.0] - 2026-06-08

### Changed
- Hydration UX streamlined; removed custom amount button in favour of preset options.

---

## [0.32.8] - 2026-06-08

### Changed
- patch: address timezone issue in hydration panel

## [0.32.7] - 2026-06-08

### Fixed
- History pagination now loads correctly on all screen sizes.

---

## [0.32.6] - 2026-06-06

### Changed
- patch: history pagination work

## [0.32.5] - 2026-06-06

### Changed
- patch: personid action panel fixes

## [0.32.4] - 2026-06-06

### Changed
- patch: personid action panel fixes

## [0.32.3] - 2026-06-06

### Changed
- patch: dependancy updates

## [0.32.2] - 2026-06-01

### Changed
- patch: rework person dashboard and hydration tracker

## [0.32.1] - 2026-06-01

### Changed
- patch: minor tweaks after goals screen and introduction of hydration

## [0.32.0] - 2026-06-01

### Added
- Goals screen per person (observation targets with optional target dates).
- Hydration observation type with daily bar-chart summary.
- Consolidated schedule management for both medications and observations.

### Changed
- Person dashboard reworked with hydration tracker panel.

---

## [0.31.0] - 2026-06-01

### Added
- feat: add hydration goals and tracking

## [0.30.0] - 2026-05-29

### Added
- feat: introduce unit tests

## [0.29.20] - 2026-05-29

### Added
- Person screen alert panel showing medication status (overdue, due soon, PRN cooldown).

### Fixed
- 24-hour maximum dose calculation bug.
- PRN alert UX edge cases.

---

## [0.29.19] - 2026-05-29

### Changed
- patch: ICA fifth pass fixes

## [0.29.18] - 2026-05-29

### Changed
- patch: ICA fourth pass fixes

## [0.29.17] - 2026-05-29

### Changed
- patch: ICA second pass fixes part 2, and third pass fixes

## [0.29.16] - 2026-05-29

### Changed
- patch: ICA second pass fixes part 1

## [0.29.15] - 2026-05-29

### Changed
- patch: ICA first pass fixes

## [0.29.14] - 2026-05-29

### Changed
- patch: adjustment to PRN alert UX bugfix

## [0.29.13] - 2026-05-29

### Changed
- patch: adjustment to PRN alert UX part 4

## [0.29.12] - 2026-05-29

### Changed
- patch: adjustment to PRN alert UX part 3

## [0.29.11] - 2026-05-29

### Changed
- patch: adjustment to PRN alert UX part 2

## [0.29.10] - 2026-05-29

### Changed
- patch: adjustment to PRN alert UX part 1

## [0.29.2] - 2026-05-25

### Changed
- patch: revise summarised alert behaviour and fix 24 hour max time bug

## [0.29.1] - 2026-05-25

### Changed
- patch: remove old person screen alert panel

## [0.29.0] - 2026-05-25

### Added
- feat: person screen alert panel

## [0.28.15] - 2026-05-25

### Fixed
- fix: dashboard wording, accessibility contrast and tap targets

## [0.28.14] - 2026-05-25

### Fixed
- fix: dashboard wording, accessibility contrast and tap targets

## [0.28.13] - 2026-05-25

### Changed
- patch: fix icon update

## [0.28.12] - 2026-05-25

### Changed
- patch: fix icon update

## [0.28.11] - 2026-05-25

### Changed
- patch: fix icon update

## [0.28.10] - 2026-05-25

### Fixed
- fix: restore ESLint compatibility by pinning brace-expansion to patched v1.x

## [0.28.9] - 2026-05-25

### Fixed
- fix: notification deep link, unlock redirect, BP chart contrast, push acknowledgement, app icons

## [0.28.8] - 2026-05-24

### Changed
- patch: resolve dependabot vulnerability alerts

## [0.28.7] - 2026-05-18

### Changed
- patch: update logo

## [0.28.6] - 2026-05-17

### Changed
- patch: changes to support demo instance, admin gating

## [0.28.5] - 2026-05-17

### Changed
- patch: changes to support demo instance, repo move to org

## [0.28.4] - 2026-05-16

### Changed
- patch: remove unlock prompt prior to biometric

## [0.28.3] - 2026-05-15

### Changed
- chore: bump version to 0.28.3

## [0.28.2] - 2026-05-15

### Changed
- patch: push notification troubleshooting

## [0.28.1] - 2026-05-15

### Changed
- patch: push notification troubleshooting

## [0.28.0] - 2026-05-15

### Added
- Codebase prepared for public open-source release under GNU AGPL v3.0.
- Improved accessibility: contrast ratios, tap target sizes, dashboard wording.
- App icon set updated.

### Fixed
- Push notification deep links.
- App unlock redirect flow.
- Blood pressure chart contrast.

---

## [0.27.2] - 2026-05-15

### Changed
- patch: push notification troubleshooting

## [0.27.1] - 2026-05-15

### Changed
- patch: observation overdue timing

## [0.27.0] - 2026-05-15

### Added
- Web Push notification support (VAPID-based).
- Per-person, per-user notification preference toggles.
- Cron jobs for scheduled dose reminders, PRN reminders, and overdue observation alerts.
- Push notification deduplication via `push_log` table.

---

## [0.26.3] - 2026-05-15

### Changed
- patch: general code hygiene

## [0.26.2] - 2026-05-15

### Changed
- patch: biometric app lock theming

## [0.26.1] - 2026-05-15

### Changed
- patch: biometric app lock fixes

## [0.26.0] - 2026-05-15

### Added
- WebAuthn-based app lock with configurable timeout.
- Lock overlay with biometric/PIN re-authentication prompt.

---

## [0.25.4] - 2026-05-15

### Changed
- patch: address identified security issues

## [0.25.3] - 2026-05-15

### Changed
- patch: adjust late medication behaviour for scheduled meds

## [0.25.2] - 2026-05-15

### Changed
- patch: adjust validity of observations for reminders

## [0.25.1] - 2026-05-10

### Changed
- patch: profile for entra users

## [0.25.0] - 2026-05-10

### Added
- TOTP/authenticator-app MFA for local (email + password) accounts.
- Profile page for Entra users.

### Changed
- Permissions model: `canReport` is now orthogonal to the `readonly → readwrite → manager → admin` ladder.

---

## [0.24.10] - 2026-05-09

### Changed
- patch: various fixes

## [0.24.9] - 2026-05-09

### Changed
- patch: code hygiene

## [0.24.8] - 2026-05-09

### Changed
- patch: code hygiene

## [0.24.7] - 2026-05-08

### Changed
- patch: adjust medication schedule behaviour

## [0.24.6] - 2026-05-08

### Changed
- patch: adjust medication schedule behaviour

## [0.24.5] - 2026-05-08

### Changed
- patch: adjust medication schedule interface

## [0.24.4] - 2026-05-08

### Changed
- patch: adjust behaviour of medication schedules

## [0.24.3] - 2026-05-08

### Changed
- patch: adjust layout of person page

## [0.24.2] - 2026-05-08

### Changed
- patch: adjust layout of person page

## [0.24.1] - 2026-05-08

### Changed
- patch: adjust prescription reminders to deep-link to med

## [0.24.0] - 2026-05-08

### Added
- Per-medication prescription scheduling UI (times, frequency, start/end dates).
- Schedule-based push notification reminders with deep links.

---

## [0.23.0] - 2026-05-08

### Added
- First-run wizard at `/setup` (creates initial admin account, first person, marks setup complete).
- `setup_complete` system config gate via proxy redirect.

---

## [0.22.2] - 2026-05-08

### Changed
- patch: allow for additive reports role

## [0.22.1] - 2026-05-08

### Changed
- patch: fix build error

## [0.22.0] - 2026-05-08

### Added
- Local credentials auth provider (email + bcrypt password).
- Local user management UI under `/admin/local-users`.
- Updated sign-in page supporting both Entra ID and local login.

---

## [0.21.3] - 2026-05-08

### Changed
- patch: pre-early tester schema and package changes

## [0.21.2] - 2026-05-08

### Changed
- patch: cleanup

## [0.21.1] - 2026-05-08

### Changed
- patch: adjust person card click/tap behaviour

## [0.21.0] - 2026-05-08

### Added
- Observation types moved from static code to the database, allowing per-type display configuration (chart type, units, staleness threshold, sort order, age caps).
- Dashboard presentation improvements.

### Fixed
- Code hygiene pass; removed AI-generated inconsistencies.

---

## [0.20.5] - 2026-05-07

### Changed
- patch: fix dashboard notification staleness

## [0.20.4] - 2026-05-07

### Changed
- patch: fix dashboard notification staleness

## [0.20.3] - 2026-05-07

### Changed
- patch: migrate confirmation prompts to Modals rather than native dialog

## [0.20.2] - 2026-05-07

### Changed
- patch: finalise formatting for observation reminders

## [0.20.1] - 2026-05-07

### Changed
- patch: adjust notification dashboard

## [0.20.0] - 2026-05-07

### Changed
- patch: AI removal (due to model incompatibility, path cleanups, database cleanups

## [0.19.0] - 2026-05-07

### Added
- Observation import from `.xlsx` files via the Management area.
- `exceljs` replaces `xlsx` library.

---

## [0.18.0] - 2026-05-07

### Added
- SVG line charts (800×300) with hover/tap tooltips on observation history pages.
- Two-column observation layout on desktop.

---

## [0.17.3] - 2026-05-06

### Changed
- patch: med search adjustments

## [0.17.2] - 2026-05-06

### Changed
- patch: dashboard adjustments

## [0.17.1] - 2026-05-06

### Changed
- patch: dashboard adjustments

## [0.17.0] - 2026-05-06

### Added
- Dashboard status indicators (RAG) on the home people list.
- Dashboard functions integrated into the home screen.

---

## [0.16.6] - 2026-05-06

### Changed
- patch: adjustments to tab formatting

## [0.16.5] - 2026-05-06

### Changed
- patch: adjustments to medication rules

## [0.16.4] - 2026-05-06

### Changed
- patch: adjustments to medication rules

## [0.16.3] - 2026-05-06

### Changed
- patch: adjustments to medication rules

## [0.16.2] - 2026-05-06

### Changed
- patch: update dosage rules

## [0.16.1] - 2026-05-06

### Changed
- patch: update dosage rules

## [0.16.0] - 2026-05-06

### Added
- Inline weight prompt when recording a dose for a person under 18, so weight-banded dosing rules apply immediately without a separate settings step.

---

## [0.15.2] - 2026-05-06

### Changed
- patch: adjustments to BP charting

## [0.15.1] - 2026-05-06

### Changed
- patch: restore footer, tweak layout of admin screen

## [0.15.0] - 2026-05-06

### Added
- Management hub (`/management`): people, medications, groups, frequency rules, observation types, import.
- Admin overview (`/admin`): site status, local user management.
- Navigation restructure separating daily use from configuration.

---

## [0.14.0] - 2026-05-06

### Added
- Blood pressure consolidated to dual paired recording.
- Head circumference observation type (age-capped, shown for under-3s by default).

---

## [0.13.0] - 2026-05-06

### Changed
- chore: upgrade Node to 24 LTS and update dependencies

## [0.12.8] - 2026-05-06

### Changed
- patch: minor layout tweak

## [0.12.7] - 2026-05-04

### Changed
- patch: continue to troubleshoot footer layout bugs, and fix docker healthcheck

## [0.12.6] - 2026-05-04

### Changed
- patch: continue to troubleshoot footer layout bugs

## [0.12.5] - 2026-05-04

### Changed
- patch: continue to troubleshoot footer layout bugs

## [0.12.4] - 2026-05-02

### Changed
- patch: continue to troubleshoot footer layout bugs

## [0.12.3] - 2026-05-02

### Security
- security: remove powered-by header, reduce session maxAge to 7 days, minor UI fixes

## [0.12.2] - 2026-04-29

### Changed
- Release v0.12.2 (early development; see git history).

## [0.12.1] - 2026-04-27

### Changed
- Release v0.12.1 (early development; see git history).

## [0.12.0] - 2026-04-27

### Changed
- Release v0.12.0 (early development; see git history).

## [0.11.0] - 2026-04-27

### Changed
- Release v0.11.0 (early development; see git history).

## [0.10.6] - 2026-04-27

### Changed
- Release v0.10.6 (early development; see git history).

## [0.10.5] - 2026-04-27

### Changed
- Release v0.10.5 (early development; see git history).

## [0.10.4] - 2026-04-27

### Changed
- Release v0.10.4 (early development; see git history).

## [0.10.3] - 2026-04-27

### Changed
- Release v0.10.3 (early development; see git history).

## [0.10.2] - 2026-04-27

### Changed
- Release v0.10.2 (early development; see git history).

## [0.10.1] - 2026-04-27

### Changed
- Release v0.10.1 (early development; see git history).

## [0.10.0] - 2026-04-27

### Changed
- Release v0.10.0 (early development; see git history).

## [0.9.0] - 2026-04-27

### Changed
- Release v0.9.0 (early development; see git history).

## [0.8.1] - 2026-04-27

### Changed
- Release v0.8.1 (early development; see git history).

## Historical notes

- Versions **0.29.3** through **0.29.9** were never tagged and are intentionally omitted from this changelog.
- Skeleton entries for releases before **0.14.0** are one-line summaries derived from annotated git tag subjects; see git history for full detail.
