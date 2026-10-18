<p align="center">
  <img src="public/icons/logo.svg" alt="FamilyChart" width="96" height="96">
</p>

<h1 align="center">FamilyChart</h1>

<p align="center">
  A family medication and health observation PWA.<br>
  Record doses, track observations, and chart history — for families managing more than one person’s health.
</p>

<p align="center">
  <a href="https://familychart.app">Managed Hosting</a>
  ·
  <a href="#quick-start">Self-host</a>
  ·
  <a href="#features">Features</a>
  ·
  <a href="#environment-variables">Env vars</a>
  ·
  <a href="#roles">Roles</a>
  ·
  <a href="#documentation">Docs</a>
  ·
  <a href="#licence">Licence</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="Licence: AGPL v3" src="https://img.shields.io/badge/licence-AGPL%20v3-blue.svg"></a>
  <a href="https://nextjs.org/"><img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-black"></a>
  <a href="https://nodejs.org/"><img alt="Node.js 24" src="https://img.shields.io/badge/node-24+-339933?logo=node.js&logoColor=white"></a>
</p>

---

> [!NOTE]
> **Managed Hosting** is available at **[familychart.app](https://familychart.app)**. We provision and run the instance (backups, updates, encryption at rest). Sign up there if you do not want to operate Docker yourself. This repository is the self-hosted and development codebase.

## Quick start

Two ways to run this repository. **Local development** is the default for contributors. **Docker** is the usual self-hosted production path. Pick one.

### 1. Copy environment

```bash
cp .env.local.example .env.local   # local dev
# cp .env.local.example .env       # Docker
```

Fill in at least `NEXTAUTH_SECRET` and `NEXTAUTH_URL`. Commented defaults live in [`.env.local.example`](.env.local.example); the [environment variables](#environment-variables) section summarises every key.

<details>
<summary><strong>Prerequisites</strong></summary>

**Local development** — Node.js 24+ and npm.

**Docker deployment** — Docker and Docker Compose.

**Microsoft Entra ID** — an Entra (Azure AD) tenant with:

- An app registration with Microsoft Graph `openid`, `profile`, `email`, and `GroupMember.Read.All` (or `group membership` claims)
- The `auth_time` optional claim added for ID tokens (Token configuration → Add optional claim → ID → `auth_time`, then grant admin consent). Confirming a sign-in again for App lock turn-off, Person erase and Account removal is judged from this claim. If the claim is not emitted, normal sign-in still works but those Entra confirmations are always refused with a prompt to sign in again ([ADR-0016](docs/adr/0016-app-lock-device-bound-credential.md))
- Security groups mapped in env vars for each role you use — at minimum ReadOnly + ReadWrite; add **Manager** and **Admin** groups if those tiers should map from Entra; add **Reports** if you use that capability (see [Roles](#roles))

**Local credentials only** — no external identity provider. On first launch the app redirects to `/setup` to create an admin account (or seed `accounts` manually and set `system_config.setup_complete` if you skip the wizard). Further local sign-in accounts are invited by email from `/admin/accounts` (requires outbound email).

</details>

### 2. Run it

<details open>
<summary><strong>Local development</strong></summary>

```bash
npm install
npm run dev
```

The app runs at `http://localhost:4000` (see `package.json` `dev` script).

</details>

<details>
<summary><strong>Docker</strong></summary>

Copy `.env.local.example` to `.env` and fill in production values, then:

```bash
docker compose up -d --build
```

The SQLite database and uploaded photos are stored in the `familychart-data` Docker named volume and survive rebuilds.

</details>

### 3. Verify

```bash
npm run typecheck   # TypeScript only
npm run build       # production build
npm run lint        # ESLint
npm run test:run    # Vitest (non-interactive)
```

Contributor workflow, native-module notes, and doc-sync rules: [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## Features

### Recording

- **Home dashboard** — red/amber/green status per person at a glance; drill into issues without opening each profile first
- **Medication recording** — log doses with dosage, comments, timestamps, and who administered it (you, another caregiver, or away from home — e.g. school or daycare); mark a scheduled dose as routinely given away from home for a parent-entered term, and answer a simple Yes / No / Not yet when it falls due; warn panel shows time since last dose, daily totals, and countdown to next safe dose
- **Dose timing and Missed doses** — a dose for a scheduled medication is labelled against its slot: within 10 minutes either side is On time and attaches silently; outside that, a banner after Save asks which dose it was (Late, Early or Extra dose). Unanswered, it stays an extra dose, and the dose is saved either way. A slot that ends with no dose is Missed. History marks only exceptions ("41 min late"), the medication timeline shows ring colours, dotted slot lines and a cross for Missed, and the person page shows Missed as a quiet line, not an alert. Missed never blocks recording a dose. Slot outcomes travel in Person and household exports ([ADR-0029](docs/adr/0029-dose-timing-and-missed.md))
- **Medication timeline** — the Person action screen opens on a status region that swipes between Alerts and a Medication timeline: the last 24 hours and the next 6, one lane per medication, with a ring on each dose coloured by how it went (On time, Late, Early), dotted lines at scheduled dose times, a cross for a Missed slot, and bands for the cooldown and the 24 hour maximum. Tapping a dose opens it in Activity, and a medication row in Activity can be shown on the timeline
- **Frequency rules** — configurable per-medication dosing rules with age/weight banding (group-level rules are retained but no longer enforced). Configured min-interval and 24h maxima drive dashboard alerts and push reminders only — saving a dose is never blocked by them (FamilyChart records history; see [ADR-0011](docs/adr/0011-prn-rules-are-alerts-not-write-gates.md))
- **Times in the household's timezone** — a date and time typed on the Record and History screens are read in the instance timezone (Setup, or `FC_DEFAULT_TIMEZONE`), not the phone's, so the dose log matches the schedule and cooldowns; when the phone is in a different zone a hint under the time field says which zone applies
- **Show password and a plain sign-in error** — every password field on the sign-in, setup, invite and reset screens has a “Show password” checkbox (off by default; pasting and password managers are never blocked), and a failed sign-in says only “Email or password is incorrect.” and returns focus to the email field, so it never reveals which part was wrong
- **Medication schedules** — per-person prescribed dose times with schedule frequency and date range
- **Medication groups** — group related medications (e.g. brand variants of the same drug) to define a shared active-ingredient set for dose history (group-level frequency rules are not enforced)

### Observations and history

- **Health observations** — ten observation types (weight, height, temperature, blood pressure, heart rate, SpO₂, blood glucose, respirations, head circumference, hydration) with unit conversion; hydration day totals and goals on person history, with quick amounts (Mug 250 mL, Can 375 mL, Glass 400 mL, Bottle 600 mL) and Hydration Favourites that open the record page with an amount already filled in
- **Observation reminders** — per-person configurable cadence for any observation type (daily, weekly, monthly, yearly, or custom interval); tracks last-recorded and next-due dates
- **History** — three tabs: Activity (a merged chronological timeline across all record types), Calendar (a symptom is a line across every day it spans) and Summaries (Medication, Observation, Symptom and Test Result, each with when it was last recorded, counts and a per-item record list, and a drill-down that adds its own level to the breadcrumb); date range and record-type filtering; edit and delete
- **Symptom and dose links** — optional, descriptive links between a symptom and the medication doses given for it. Record Medication and Record Symptom each offer one quiet, collapsed line (absent when there is nothing to link; default no link, never a prompt step); Edit Symptom and the dose edit form add or remove links later; History shows a compact chip on both sides and the person export includes the links
- **Test results** — record a lab/imaging report per person in two steps (name, attached report, test date, ordered by, notes; then values) with structured values chosen from a curated catalogue of about 60 metrics via type-and-search (name or alias such as Hb, TSH, BUN), each with unit, optional `<`/`>` limit qualifier and the report's reference range; a text-layer PDF can prefill values on the phone for review (Correct / Edit / Skip, no OCR, no AI), and an existing result with a PDF can be rescanned from its edit screen to add values that were missed; every attached report is checked on the phone first: Medicare number, date of birth, address, phone, email and healthcare identifier are boxed in advance (patient name and request number are offered), boxes can be drawn by hand, and only the redacted copy is stored, never the original; the **Test Result Chart** tile charts any value recorded at least twice (one series per metric and unit) over a quick or custom date range, with each report's own reference range as a shaded band, and opens catalogue panels (for example Lipids) as stacked charts on a shared date axis
- **Symptom recording** — free-text symptom with per-person autocomplete from history, start date, optional end date, severity (1–5, a slider that starts at 1 so an untouched default never raises an alert; History shows it as “Severity n/5”, red from 4 and amber from 2), and a resolved/active state; a symptom with no end date is asked about once a day on the dashboard, shown as a blue Notice with an Update button on the person screen that opens the symptom (saving it while still open counts as still ongoing; set an end date and resolved to close it), that never turns a Person amber and sends no push
- **Push notifications** — optional Web Push reminders for scheduled doses, overdue doses, PRN cooldown expiry, and overdue observations (per-person notification preferences). Recording a dose attached to its slot closes your own reminder at once and replaces it on your other devices with "You gave…"; someone else recording still sends "<name> gave…". A hydration reading updates the pacing nudge quietly while still behind, or clears it (a brief "Caught up") once on pace; muted-today sends nothing ([ADR-0030](docs/adr/0030-self-dose-and-hydration-notifications.md)). A reading never creates a nudge that was not already showing. A slot that is marked Missed by the clock (no one recording) leaves its reminder on screen until it is dismissed or replaced, because a push cannot close a notification on another device

### Access and administration

- **Management** — `/management` hub for **Manager and Admin** roles: people, curating the medication catalogue (groups, frequency rules and active flags; any ReadWrite Account, and a Personal-link Account for its own Person, can still add a new medication by name when recording a dose), observation type catalogue (show/hide curated types), spreadsheet import (not available to ReadWrite-only users)
- **Administration** (`/admin`) — **Admin** role: overview dashboard, accounts (invite to sign in), Entra access-control membership (read-only), audit log viewer, household files (`/admin/files`), Data Export & Restore (`/admin/export`, also in the header menu); users with the Reports capability use the separate Reports role / `can_report` flag
- **Person export** — from Data Export & Restore, a zip of one Person's record: their history, the medications, rules, schedules, goals and expectations they use, their photo and stored reports, and spreadsheet-friendly CSV copies. Inactive Persons are listed and labelled. Each row shows a size before download (“about 42 MB, including 38 MB of reports”); above 100 MB the page warns that a proxy may reject uploading the file later and that Persons can be exported individually. The file is not encrypted unless **Protect this file with a passphrase** is chosen in the download dialog, which is off by default. FamilyChart generates that passphrase and shows it once; it is not stored, and there is no way to recover it. A protected file is an AES-256 zip. Open it with 7-Zip, Keka or WinZip — stock Windows Explorer and the built-in `unzip` command cannot. Entry names and sizes stay visible and do not include a person's name or the original file name. An unprotected download says the file is not encrypted and holds health information, so store it somewhere private. An Admin can export any Person, including inactive ones. Profile → Account offers **Export my data** to an Account with a Personal-link, whatever its Household Role (None included), with the same size and warnings; the entry is absent without a link, and a None-role Account does not see the Administration page. The download is fetched in the page and the file is saved only once the whole stream has finished. The file streams as it is built, opens with a versioned `manifest.json` that names any photo or report it could not include, and every export is audit-logged. The container log gets one `person_export` line (counts, whether it was protected, the actor's Household Role or "self", and the outcome) with no name, email, file name or passphrase. An unprotected export is not encrypted. Neither kind holds passwords or sign-in data. Format: [ADR-0028](docs/adr/0028-export-format.md)
- **Household export** — an Admin-only zip of the whole household from Data Export & Restore: the shared medication catalogue (groups, frequency rules and which medicines are active), Accounts as invites with no passwords or MFA secrets, Favourites, non-secret instance settings, durable per-user preferences (timezone, hydration pacing and notification preferences, keyed by ids inside the file, never an email or Account id), and one folder per Person containing that Person's export. A Person export carries only that Person's own settings. Transient hydration state, push subscriptions, App lock and other device-only state stay behind. Adding the preferences section raised the export format version; an older FamilyChart refuses the file, and a newer one still reads an older file that has no such section. The page shows a size estimate and the same notice that an unprotected file is not encrypted and holds health information, and warns again above 100 MB because a proxy may reject uploading it later. The download dialog can protect the household file with a generated passphrase, off by default, on the same terms as a Person export. Format: [ADR-0028](docs/adr/0028-export-format.md) The container log gets one `household_export` line with the same fields as a Person export and no personal data.
- **Restore** — on Data Export & Restore, an Admin uploads a FamilyChart export (a `.zip`, up to the upload limit) and reviews it before anything is written. A protected file asks for its passphrase before the preview. A wrong passphrase can be tried again on the same upload, and an unsupported encryption option is refused. Each Person can be New, Map to existing or Skip; an exact name and date of birth is pre-selected as Map to existing, the two dates are shown side by side, and a warning appears when they differ. Medications match by name and can be overridden. Configuration differences are listed and the instance's rules, schedules and goals are kept. Favourites are restored for Accounts that were invited, pointing at the mapped Person and medication, and are there after the Invite is accepted. Instance settings that are not secrets and not locked by the platform are applied only when this instance does not already have them; a setting this instance already has, or one locked by the environment, is kept and shown in the preview. Secrets and platform-locked settings are not applied. Durable per-user preferences are filled in where the Account does not already have them; a value this instance already has is kept, and a value that is not valid is dropped and counted. On a Person export each Person has an optional Sign-in field: a new email becomes a pending Invite (sent when outbound email is configured, otherwise left for the Admin to send later; on an Entra instance it is claimed on first sign-in), an existing Account with no Personal-link is linked, an Account already linked to someone else is refused, and a blank field carries no personal settings and says so. Apply stays unavailable until the preview is confirmed. The result names what was created, what was kept and what was not restored, including per-user settings once they are restored. On a phone the restore section says Desktop Required; downloads on the same page still work. The upload streams to a temporary file (it is not held in memory), expires after 30 minutes, and is deleted after a successful apply. Records are added and exact duplicates are skipped, so running the same restore again adds nothing. History for an observation type or test metric that has been switched off is restored, and the on/off flags are applied afterwards; a type this instance does not have is skipped and listed. Photos and reports are written only after the database change succeeds, and removed if a write fails. Restore is refused in demo mode. An export with no manifest, or from a newer FamilyChart, is refused before anything is written. A person whose Entra Account was removed on this instance is left out of the account list, with the reason "removed on this instance; allow them back first", when the file names that Entra object id. A removed email can be invited again only if an Admin includes it; record text that already says "Removed account" stays that way. A successful or failed apply writes one `restore_applied` line to the container log, with counts and outcome and no personal data.
- **Account removal** — an Admin permanently removes another Account from Administration → Accounts after typing that Account's email. The Account holder can remove their own from Profile → Account after signing in again. This deletes the sign-in (password, authenticator, invite, sessions), push subscriptions, Favourites, that Account's settings and notification history, and the Personal-link. It does not delete Person records; a linked Account has to be unlinked first, or removed as part of erasing the Person. The last active local Admin cannot be removed (a disabled Admin does not count as another). The email on the audit log and on record history is replaced with a random token that the screens show as "Removed account". One new audit entry records who removed it, when, and how many rows changed, without the old email. An Entra Account is not recreated on the next sign-in: that person sees a page saying their account was removed until an Admin chooses **Allow this person back** on Entra Sessions. Removal does not touch operator backups or export files someone already holds. Not available in the demo. See [ADR-0027](docs/adr/0027-account-removal.md)
- **Person erase** — permanently removes one Person's records, photo and stored reports. An Admin can erase a Person who has already been deactivated. An Account with a Personal-link can erase its own Person (deactivating and erasing in one step) after confirming its password, or after a fresh Entra sign-in. The audit log keeps who did what and when, but the content of those entries is cleared, and a new entry records that a Person was erased, with counts and no name or date of birth. A None-role Account linked to the Person is signed out afterwards; an Account with a household role stays able to sign in. Erase does not touch operator backups. Restoring a backup taken before the erase can bring that Person back, and they need to be erased again. From Data Export & Restore an Admin opens a confirmation for a deactivated Person: it shows how many doses, observations, test results with reports and photos will go, offers a download first (not required), warns that backups taken before the erase may still contain the Person, and asks for the Person's name. Erase stays unavailable, and says why, until that name matches and any download started on the page has finished. A manager can put a removed Person back on the family list from that inactive list; the change is audited. Profile → Account offers the same confirmation to an Account with a Personal-link. When the Person has a linked Account, the confirmation offers to permanently remove that Account as well: on by default for Household Role None, off when the Account has a role, and unavailable with a reason when that Account is the last local Admin. The result says the account was removed, that it stays unless an administrator removes it, or that a None-role account has been deactivated and the person is signed out. Not available in the demo. The container log gets one `person_erased` line (counts and outcome, no name or date of birth). See [ADR-0025](docs/adr/0025-person-erase.md)
- **Entra access without Graph** — Entra sign-in works without extra Graph permissions, but then nobody's access is rechecked in the background. An Entra user with no group data stays authorised for push reminders until you revoke them or they unsubscribe (deliberately fail-open: failing closed would silently drop medication reminders). Administration → Entra Sessions and the Administration overview show a warning while this applies (Graph not configured, or a user without group data for about two hours), Admins with a push subscription get a weekly push, and Admins without one get a weekly email instead (so each Admin hears through one channel). Neither carries personal data. The email goes to active Admin Accounts that have an email address and no push subscription, only when outbound email is configured (SMTP, or Graph mail on the managed platform); Entra Sessions says when email alerts are off for that reason. It is sent when the warning first appears and at most once per ISO week while it lasts. There is no setting to turn it off: fix the cause (below) and it stops, and a later recurrence emails again straight away. Fix it by granting the Graph permissions (`User.Read.All` and `GroupMember.Read.All`), or use Revoke when someone leaves ([ADR-0009](docs/adr/0009-entra-live-revocation.md))
- **Account status** — each row on Administration → Accounts shows one chip: Disabled, Revoked, Expired, Invited or Active. An admin can turn sign-in off for a local account (the row is dimmed and shows Disabled); an Entra account has no such switch, because its sign-in is controlled in Entra
- **RBAC** — hierarchical roles (ReadOnly → ReadWrite → Manager → Admin) via Microsoft Entra ID security groups or local email/password accounts, plus an independent **Reports** capability
- **MFA** — optional TOTP/authenticator-app second factor for local (email + password) accounts
- **App lock** — re-locks the device whenever you leave the app and unlocks with a device-bound WebAuthn credential (fingerprint, face, or screen lock) rather than a passkey; an optional per-device grace period (Immediately, 30s, 1m, 5m) skips re-locking for a short app switch. The credential is stored per signed-in account on that device
- **Audit log** — every write action recorded with user, entity, and detail; admins can browse a paginated, filterable viewer under Administration. Person export, restore and Person erase also write one structured container-log line each (`person_export`, `restore_applied`, `person_erased`). Household export and Account removal use the same line (`household_export`, `account_removed`). The fields are counts, whether an export was protected, the actor's Household Role or "self", and the outcome. Those lines omit names, email addresses, file names and passphrases. The audit log entries are unchanged.

### App shell

- **Save confirmation and form errors** — saving a record returns to the person screen with a dismissible “Saved: …” banner (announced to screen readers, shown once); a failed save announces the problem and moves focus to the field to fix; the closed Quick record sheet can no longer be reached by keyboard or screen reader
- **Breadcrumbs** — every screen below a hub shows a trail under the person header (or at the top of the page) that goes up the app's structure, for example Bec / History or Administration / Accounts, with the current screen as the last item; on Summaries and the Test Result Chart a deeper step adds a level, such as Bec / Test results / General Chemistry. Going up never depends on browser history. The person details page is titled “Select an Action” and shows the person's name beside their avatar
- **Error page** — an unexpected error shows a “Something went wrong” page with Try again and Go Home instead of the framework's default error page
- **Diagnostics** — a footer link, for a signed-in and unlocked user, to an App lock tool that tries credential option sets, shows the device's App lock state and copies a log for support
- **PWA** — installable, mobile-first, full-width layout with safe area insets
- **First-run wizard** (`/setup`) — when `setup_complete` is not set: create the initial local admin, optionally enroll MFA, add a first person (or, on a desktop, restore from an export instead), set the instance timezone, optionally configure SMTP, then open the app; shows a short “Getting started” card on the home screen

---

## Tech stack

| Layer | Choice |
|---|---|
| App | [Next.js](https://nextjs.org/) 16 (App Router), [React](https://react.dev/) 19, [TypeScript](https://www.typescriptlang.org/) 6 (strict; `npm run typecheck` uses the native 7 compiler) |
| UI | [Tailwind CSS](https://tailwindcss.com/) v4 (CSS variable–based theme) |
| Data | [better-sqlite3-multiple-ciphers](https://github.com/m4heshd/better-sqlite3-multiple-ciphers) — SQLite, single file, optional SQLCipher encryption at rest |
| Auth | [NextAuth](https://authjs.dev/) v5 — Microsoft Entra ID and local credentials (bcryptjs) |
| Email | [nodemailer](https://nodemailer.com/) v10 (managed Microsoft Graph or SMTP) |
| Tests | [Vitest](https://vitest.dev/) |
| Runtime | Node 24; Docker for production |

---

## Environment variables

See [`.env.local.example`](.env.local.example) for commented defaults. Summary below.

> [!TIP]
> Generate VAPID keys with `npx web-push generate-vapid-keys`.

<details open>
<summary><strong>Core</strong></summary>

> [!NOTE]
> **Upgrading to 1.1.0.** The History association setting (`FC_SCHEDULE_SLOT_ASSOCIATION_RADIUS_MINUTES`) is retired and ignored if still set. A dose is On time within a fixed 10 minutes either side of its slot; outside that window the record screen asks which dose it was. The "Cancel the <time> reminder" tick box on Record Medication is gone, because an early dose is now attached to the next slot through that question, and a migration drops any old cancellations and the stored radius value. A slot that ends with no dose is recorded as Missed: information only, never an alert ([ADR-0029](docs/adr/0029-dose-timing-and-missed.md)). The lead and overdue offset settings are unchanged.

| Variable | Required | Description |
|---|---|---|
| `NEXTAUTH_SECRET` | Always | Random secret for NextAuth session encryption (`openssl rand -base64 32`; must be ≥32 chars in production — boot fails on placeholders) |
| `NEXTAUTH_URL` | Always | Public URL of the app (e.g. `https://yourapp.example.com`; use `http://localhost:4000` for default local dev) |
| `BEHIND_REVERSE_PROXY` | Optional | Set `true` when a reverse proxy terminates TLS before the app. Drives host trust and XFF rate-limit parsing. Default: `false` (set `true` in Docker/proxy deployments). See [ADR-0007](docs/adr/0007-reverse-proxy-mode.md). |
| `TRUST_PROXY_DEPTH` | Optional | When `BEHIND_REVERSE_PROXY=true`: number of trusted reverse-proxy hops. Auth rate-limiter reads the Nth `X-Forwarded-For` entry from the right. Default: `1` (managed hosting sets `2`). |
| `DB_PATH` | Optional | Path to the SQLite database file (default: `./data/familychart.db`) |
| `FC_RESTORE_MAX_UPLOAD_MB` | Optional | Largest restore upload, in megabytes. Default: `512`. The bytes stream to a temporary file. A reverse proxy in front of the app must allow at least this much (`client_max_body_size` on nginx). Managed hosting's edge accepts at most 100 MB per request, so a managed instance sets this to about 95. |

</details>

<details>
<summary><strong>Microsoft Entra ID</strong></summary>

| Variable | Required | Description |
|---|---|---|
| `FC_AUTH_ENTRA_ENABLED` | Optional | Set `true` to enable Microsoft Entra sign-in. Default: `false`. When unset, Admin → System Settings (`auth.entra.enabled`) applies. Local credentials stay available either way. |
| `AUTH_MICROSOFT_ENTRA_ID_ID` | Entra only | App registration Client ID. Sign-in only needs no special Graph permission; **granting app-only `User.Read.All` + `GroupMember.Read.All` on this same app registration additionally enables live background revocation** ([ADR-0009](docs/adr/0009-entra-live-revocation.md)) — self-hosters who skip this still get correctly-functioning Entra sign-in, just without the hourly Graph revalidation: Entra users then stay authorised (including for push reminders) until revoked or unsubscribed, and Admins see a warning plus a weekly push or email about it. |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | Entra only | App registration Client Secret |
| `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID` | Entra only | Entra ID Tenant ID |
| `ENTRA_GROUP_ADMIN` | Entra only | Object ID of the Admin security group |
| `ENTRA_GROUP_MANAGER` | Entra only | Object ID of the Manager security group (`/management` access) |
| `ENTRA_GROUP_READWRITE` | Entra only | Object ID of the ReadWrite security group |
| `ENTRA_GROUP_READONLY` | Entra only | Object ID of the ReadOnly security group |
| `ENTRA_GROUP_REPORTS` | Entra only | Object ID of the Reports security group |
| `ENTRA_SESSION_MAX_AGE_MINUTES` | Entra only | Fail-safe bound (minutes): max time since the last *successful background revalidation* (or sign-in, if never yet revalidated) before interactive re-authentication is forced. Live revocation ([ADR-0009](docs/adr/0009-entra-live-revocation.md)) narrows real exposure well below this window when the Graph permissions below are granted. When the bound lapses the user is sent to the login page (not an access-denied screen) and signed straight back in via Entra SSO. Default: `480` (8 hours) |

</details>

<details>
<summary><strong>Encryption at rest</strong></summary>

| Variable | Required | Description |
|---|---|---|
| `FC_ENCRYPTION_MODE` | Optional | At-rest encryption for DB **and** file uploads: `none` (default), `env`, or `keyserver` — see [ADR-0003](docs/adr/0003-database-encryption-modes.md) |
| `FC_DB_KEY` | Env mode | 64-char hex DB passphrase when `FC_ENCRYPTION_MODE=env` |
| `FC_FILE_KEY` | Env mode | 64-char hex file-upload passphrase when `FC_ENCRYPTION_MODE=env` (required; fail-closed) |
| `DB_KEY_SERVER_URL` | Keyserver mode | Key server base URL when `FC_ENCRYPTION_MODE=keyserver` |
| `DB_KS_TOKEN` | Keyserver mode | Per-instance bearer token for `/unwrap` |
| `DB_WRAPPED_KEY` | Keyserver mode | Wrapped DB passphrase blob |
| `FILE_WRAPPED_KEY` | Keyserver mode | Wrapped file-upload passphrase blob (required; fail-closed) |
| `DB_KS_CUSTOMER_ID` | Keyserver mode | Keyserver customer id (usually instance subdomain) |

</details>

<details>
<summary><strong>Push, cron, and email</strong></summary>

| Variable | Required | Description |
|---|---|---|
| `VAPID_SUBJECT` | Push only | `mailto:` or `https:` URI for Web Push VAPID |
| `VAPID_PUBLIC_KEY` | Push only | VAPID public key (base64url) |
| `VAPID_PRIVATE_KEY` | Push only | VAPID private key (base64url) |
| `CRON_MODE` | Optional | Set `internal` to run reminder jobs in-process (every 5 min after startup). When unset, use an external scheduler calling `GET /api/cron` |
| `CRON_SECRET` | External cron | Required when `CRON_MODE` is not `internal`; external callers must send header `x-cron-secret`. `/api/cron` returns 404 when `CRON_MODE=internal` |
| `FC_SMTP_HOST` | Optional | SMTP server hostname for outbound email (invites, password resets). Enables `email.available` when set alongside the vars below. |
| `FC_SMTP_PORT` | Optional | SMTP server port. |
| `FC_SMTP_USER` | Optional | SMTP auth username. |
| `FC_SMTP_PASSWORD` | Optional | SMTP auth password. |
| `FC_SMTP_TLS` | Optional | Use TLS for the SMTP connection. |

</details>

<details>
<summary><strong>Schedules, display, and security policy</strong></summary>

| Variable | Required | Description |
|---|---|---|
| `FC_SCHEDULE_LEAD_MINUTES` | Optional | Minutes before a slot to show amber upcoming alerts. Default: `60` (admin System Settings when unset). |
| `FC_SCHEDULE_OVERDUE_OFFSET_MINUTES` | Optional | Minutes after nominal slot time before the overdue push fires. Default: `30`. |
| `FC_DEFAULT_TIMEZONE` | Optional | Instance default IANA timezone (e.g. `Europe/London`). When set, locks the admin control |
| `FC_MEASUREMENT_SYSTEM` | Optional | `metric` (default) or `imperial` — default observation units on the record form; charts convert at display time. When set, locks the admin control |
| `FC_MFA_REQUIRED` | Optional | Require TOTP MFA for all local accounts. Default: `false` (admin System Settings when unset; locked under managed profile). |
| `FC_PASSWORD_MIN_LENGTH` | Optional | Minimum length for local account passwords. Default: `10` (admin System Settings when unset; locked under managed profile). |

</details>

<details>
<summary><strong>Platform and demo</strong></summary>

| Variable | Required | Description |
|---|---|---|
| `FC_PLATFORM_PROFILE` | Optional | `managed` disables local bootstrap (`/api/setup/bootstrap`) on provisioned instances; `demo` arms demo behaviour together with `DEMO_MODE` (platform demo only — see [ADR-0005](docs/adr/0005-demo-mode-platform-guard.md)) |
| `DEMO_MODE` | Platform demo | Set `true` with `FC_PLATFORM_PROFILE=demo` on the public demo instance only. Ignored on self-host. Enables fixed MFA OTP `123456`, blocks account changes, and hybrid reject-on-write profanity filter (local blocklist + purgomalum when demo is armed). |

</details>

---

## Roles

Access is controlled by Entra ID security group membership or local account role. Both can be active simultaneously.

| Role | Entra group env var | Local credentials role | Access |
|---|---|---|---|
| ReadOnly | `ENTRA_GROUP_READONLY` | `read` | View home screen and history for people you are allowed to see |
| ReadWrite | `ENTRA_GROUP_READWRITE` | `write` | Above + record medications and observations for permitted people, and add a new medication by name when recording a dose |
| Manager | `ENTRA_GROUP_MANAGER` | `manage` | Above + **Management** (`/management`): people, curating the medication catalogue (groups, frequency rules, active flags), observation type catalogue (show/hide), import |
| Admin | `ENTRA_GROUP_ADMIN` | `admin` | Above + **Administration** (`/admin`): overview, accounts, access control, audit log, household files (other roles do not see this menu entry) |
| None | — | `none` | No household Role. Access is the Personal-link only (own Person read/write, including adding a new medication by name while recording for that Person) plus Self-report of that Person. Not available for Entra accounts |
| Household Reports | `ENTRA_GROUP_REPORTS` | (enable `can_report` on the account) | Permission only in this release: the capability and its flag exist, but no household report or report-schedule features ship yet. Independent of the ladder, and requires a household Role on local Accounts. Self-report of a Personal-linked Person does not use this flag |

An Entra user whose OID matches `people.account_uid` gets read/write access for their own person record when they would otherwise lack global Read/Write. Local credential accounts use session ids `local:<db_id>`; the same linking applies if `account_uid` is set accordingly (unusual).

---

## Deployment notes

> [!IMPORTANT]
> The app is typically deployed behind a reverse proxy that terminates TLS. Set `BEHIND_REVERSE_PROXY=true` (and `TRUST_PROXY_DEPTH` to the number of trusted hops — default `1`, use `2` for Cloudflare → nginx chains). The proxy must **append** the connecting address to `X-Forwarded-For` (nginx: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`).

- Health check: `GET /api/health` (database connectivity). `200` = ready; in `keyserver` encryption mode, `503` means the database is up but the keyserver is unreachable (still counts as container-live — see the encryption runbook's "Keyserver outage" section).
- The SQLite schema is defined in `applyBaselineSchema()` in application code — the live 1.0.0 schema, applied idempotently on every boot. On startup the app also seeds observation type catalogue rows and runs the numbered migrations added after 1.0.0 (`schema_migrations`; the first is `018`). There is no long migration history maintained for pre-1.0.0 databases.
- Photos are stored at `<DB_PATH_DIR>/uploads/people/` and served via `/api/uploads/[filename]`. When `FC_ENCRYPTION_MODE` is `env` or `keyserver`, uploads are AES-256-GCM encrypted at rest (separate file key: `FC_FILE_KEY` / `FILE_WRAPPED_KEY`). A plaintext file already on disk is not encrypted at boot and is not served while encryption is on. Admins can inspect orphans under **Administration → Files**, which has a Photos tab and an Attachments tab (test result reports under `uploads/test-results/`) showing total space used, space per person, orphaned files (purgeable) and referenced files missing on disk.
- Push reminders require VAPID keys and a cron trigger (`CRON_MODE=internal` or external `GET /api/cron`).

---

## Backing up and recovering

FamilyChart has no in-app backup, snapshot or undo tool. Instance data lives on disk in one **data directory**: the SQLite database (default `./data/familychart.db`, or the path in `DB_PATH`) and uploaded files alongside it (`uploads/people/`, `uploads/test-results/`, and any other paths under that directory). Person and Household **exports** are portable copies of selected household data; they are not a substitute for backing up the whole instance (see [Recovery recipes](#recovery-recipes) below).

### What to back up

Copy the entire data directory while the database is in a consistent state. The simplest approach is to stop the app or container, copy the directory, then start again. If the instance must stay running, use [SQLite's online backup API](https://www.sqlite.org/backup.html) (or an equivalent) for the database file and copy `uploads/` at roughly the same time. Keep copies **off the machine** that runs the instance.

### Encryption modes

At-rest encryption is controlled by `FC_ENCRYPTION_MODE` ([ADR-0003](docs/adr/0003-database-encryption-modes.md), [encryption at rest](#encryption-at-rest) above).

| Mode | What it means for a backup |
|---|---|
| `none` | Anyone with the data directory can read the database and uploads. |
| `env` | The copy is useless without `FC_DB_KEY` and `FC_FILE_KEY`. Store those keys **separately** from the data. If you lose the keys, the encrypted data cannot be recovered. |
| `keyserver` | Managed hosting only. A copy of the data directory can be opened only on infrastructure that holds the wrapping keys and can reach the key server. |

### Managed hosting

The operator keeps scheduled, offsite backups of each instance. Customers cannot browse or restore those copies themselves. Before leaving managed hosting, download your own Person and Household exports from **Data Export & Restore** and store them securely. For a full recovery from the operator's backups, contact the operator ([familychart.app](https://familychart.app)).

### Recovery recipes

**Recover one Person from an older data-directory copy.** Run the backup as a **second** FamilyChart instance (its own data directory — never point two running instances at the same files). Sign in as an Admin on that copy, export the Person from **Data Export & Restore**, then on your live instance open the restore screen, upload that Person export and apply it.

**Move or rebuild an instance.** A [Household export](#features) is the practical way to move between servers or rebuild after a failed upgrade. It is **not** a full backup: it excludes passwords, MFA secrets, sessions, App lock state, push subscriptions, the audit log, transient hydration state and other secrets or device-specific state. Timezone, hydration pacing and notification preferences do travel. For a complete instance, still back up the data directory as above.

### Person erase and older backups

Erasing a Person does not change filesystem or operator backups taken earlier. If you restore a data-directory copy from **before** an erasure, that Person can reappear in the live database — erase them again from **Data Export & Restore**. The erase result shows the date and reminds you of this. Keep your own note of erasures: restoring the database rolls audit entries back too, so the in-app audit log is not a durable record of past erasures after a full restore.

---

## Documentation

| Document | Audience | Purpose |
|---|---|---|
| This README | Operators and new contributors | Features, setup, env vars, roles, deployment, backup and recovery |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contributors | Dev workflow, verification, doc sync |
| [`docs/architecture.md`](docs/architecture.md) | Contributors | Schema, auth, patterns, project layout |
| [`docs/adr/`](docs/adr/) | Contributors | Architecture decision records |
| [`AGENTS.md`](AGENTS.md) | AI coding assistants | Agent entry point |
| [`.env.local.example`](.env.local.example) | Operators | Commented env template — keep in sync with the env tables above |

When you change user-facing behaviour, auth, env vars, roles, or deployment steps, update this README (and `.env.local.example` when env vars change). See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full contributor reference.

---

## Licence

Copyright (c) 2026 Benjamin Horder (trading as WheelieLabs).

FamilyChart is licensed under the [GNU Affero General Public License v3.0](LICENSE). Corresponding source for the running version is linked from the in-app footer. Third-party component licences are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Security issues: see [SECURITY.md](SECURITY.md). Community standards: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
