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
- **Medication recording** — log doses with dosage, comments, and timestamps; warn panel shows time since last dose, daily totals, and countdown to next safe dose
- **Frequency rules** — configurable per-medication dosing rules with age/weight banding (group-level rules are retained but no longer enforced). Configured min-interval and 24h maxima drive dashboard alerts and push reminders only — saving a dose is never blocked by them (FamilyChart records history; see [ADR-0011](docs/adr/0011-prn-rules-are-alerts-not-write-gates.md))
- **Medication schedules** — per-person prescribed dose times with schedule frequency and date range
- **Medication groups** — group related medications (e.g. brand variants of the same drug) to define a shared active-ingredient set for dose history (group-level frequency rules are not enforced)

### Observations and history

- **Health observations** — ten observation types (weight, height, temperature, blood pressure, heart rate, SpO₂, blood glucose, respirations, head circumference, hydration) with unit conversion; hydration day totals and goals on person history
- **Observation reminders** — per-person configurable cadence for any observation type (daily, weekly, monthly, yearly, or custom interval); tracks last-recorded and next-due dates
- **History** — tabbed view with medication summary, observation line charts, and merged chronological timeline; date range filtering; edit and delete
- **Push notifications** — optional Web Push reminders for scheduled doses, overdue doses, PRN cooldown expiry, and overdue observations (per-person notification preferences)

### Access and administration

- **Management** — `/management` hub for **Manager and Admin** roles: people, medication catalogue (groups and frequency rules), observation type catalogue (show/hide curated types), spreadsheet import (not available to ReadWrite-only users)
- **Administration** (`/admin`) — **Admin** role: overview dashboard, accounts (invite to sign in), Entra access-control membership (read-only), audit log viewer, household files (`/admin/files`); users with the Reports capability use the separate Reports role / `can_report` flag
- **RBAC** — hierarchical roles (ReadOnly → ReadWrite → Manager → Admin) via Microsoft Entra ID security groups or local email/password accounts, plus an independent **Reports** capability
- **MFA** — optional TOTP/authenticator-app second factor for local (email + password) accounts
- **App lock** — optional WebAuthn gesture re-authentication after idle timeout; the biometric credential is stored per signed-in account
- **Audit log** — every write action recorded with user, entity, and detail; admins can browse a paginated, filterable viewer under Administration

### App shell

- **PWA** — installable, mobile-first, full-width layout with safe area insets
- **First-run wizard** (`/setup`) — when `setup_complete` is not set: create the initial local admin, optionally enroll MFA, add a first person, set the instance timezone, optionally configure SMTP, then open the app; shows a short “Getting started” card on the home screen

---

## Tech stack

| Layer | Choice |
|---|---|
| App | [Next.js](https://nextjs.org/) 16 (App Router), [React](https://react.dev/) 19, [TypeScript](https://www.typescriptlang.org/) 6 (strict) |
| UI | [Tailwind CSS](https://tailwindcss.com/) v4 (CSS variable–based theme) |
| Data | [better-sqlite3-multiple-ciphers](https://github.com/m4heshd/better-sqlite3-multiple-ciphers) — SQLite, single file, optional SQLCipher encryption at rest |
| Auth | [NextAuth](https://authjs.dev/) v5 — Microsoft Entra ID and local credentials (bcryptjs) |
| Email | [nodemailer](https://nodemailer.com/) v9 (managed Microsoft Graph or SMTP) |
| Tests | [Vitest](https://vitest.dev/) |
| Runtime | Node 24; Docker for production |

---

## Environment variables

See [`.env.local.example`](.env.local.example) for commented defaults. Summary below.

> [!TIP]
> Generate VAPID keys with `npx web-push generate-vapid-keys`.

<details open>
<summary><strong>Core</strong></summary>

| Variable | Required | Description |
|---|---|---|
| `NEXTAUTH_SECRET` | Always | Random secret for NextAuth session encryption (`openssl rand -base64 32`; must be ≥32 chars in production — boot fails on placeholders) |
| `NEXTAUTH_URL` | Always | Public URL of the app (e.g. `https://yourapp.example.com`; use `http://localhost:4000` for default local dev) |
| `BEHIND_REVERSE_PROXY` | Optional | Set `true` when a reverse proxy terminates TLS before the app. Drives host trust and XFF rate-limit parsing. Default: `false` (set `true` in Docker/proxy deployments). See [ADR-0007](docs/adr/0007-reverse-proxy-mode.md). |
| `TRUST_PROXY_DEPTH` | Optional | When `BEHIND_REVERSE_PROXY=true`: number of trusted reverse-proxy hops. Auth rate-limiter reads the Nth `X-Forwarded-For` entry from the right. Default: `1` (managed hosting sets `2`). |
| `DB_PATH` | Optional | Path to the SQLite database file (default: `./data/familychart.db`) |
| `ENABLED_AUTH_PROVIDERS` | Optional | **Deprecated** — boot-seeds `auth.entra.enabled` once. Local credentials always on. |
| `NEXTAUTH_USE_SECURE_COOKIES` | Deprecated | No longer affects cookie `Secure` flag — session cookies are always `Secure` outside `next dev`, since the flag is evaluated on the browser-facing HTTPS hop regardless of proxy placement. Legacy: `false` still implies `BEHIND_REVERSE_PROXY=true` (host trust / XFF) when that var is unset. |

</details>

<details>
<summary><strong>Microsoft Entra ID</strong></summary>

| Variable | Required | Description |
|---|---|---|
| `AUTH_MICROSOFT_ENTRA_ID_ID` | Entra only | App registration Client ID. Sign-in only needs no special Graph permission; **granting app-only `User.Read.All` + `GroupMember.Read.All` on this same app registration additionally enables live background revocation** ([ADR-0009](docs/adr/0009-entra-live-revocation.md)) — self-hosters who skip this still get correctly-functioning Entra sign-in, just without the hourly Graph revalidation. |
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
| `DB_ENCRYPTION_KEY` | Optional | **Legacy** — alias for `FC_DB_KEY` (env mode only). Prefer `FC_DB_KEY`. |
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
| `FC_SCHEDULE_OVERDUE_OFFSET_MINUTES` | Optional | Minutes after nominal slot time before the overdue push fires. Default: `30`. Legacy alias: `PUSH_OVERDUE_HOURS` (hours). |
| `FC_SCHEDULE_SLOT_ASSOCIATION_RADIUS_MINUTES` | Optional | Minutes within which a recorded dose associates with a scheduled slot in history. Default: `60`. |
| `PUSH_OVERDUE_HOURS` | Optional | **Legacy** — hours after slot time for overdue push when `FC_SCHEDULE_OVERDUE_OFFSET_MINUTES` is unset. Prefer the minutes var above. |
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
| ReadWrite | `ENTRA_GROUP_READWRITE` | `write` | Above + record medications and observations for permitted people |
| Manager | `ENTRA_GROUP_MANAGER` | `manage` | Above + **Management** (`/management`): people, medications, groups, frequency rules, observation type catalogue (show/hide), import |
| Admin | `ENTRA_GROUP_ADMIN` | `admin` | Above + **Administration** (`/admin`): overview, accounts, access control, audit log, household files (other roles do not see this menu entry) |
| Reports | `ENTRA_GROUP_REPORTS` | (enable `can_report` on the account) | Report generation (independent of the main role ladder) |

An Entra user whose OID matches `people.account_uid` gets read/write access for their own person record when they would otherwise lack global Read/Write. Local credential accounts use session ids `local:<db_id>`; the same linking applies if `account_uid` is set accordingly (unusual).

---

## Deployment notes

> [!IMPORTANT]
> The app is typically deployed behind a reverse proxy that terminates TLS. Set `BEHIND_REVERSE_PROXY=true` (and `TRUST_PROXY_DEPTH` to the number of trusted hops — default `1`, use `2` for Cloudflare → nginx chains). The proxy must **append** the connecting address to `X-Forwarded-For` (nginx: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`).

- Health check: `GET /api/health` (database connectivity). `200` = ready; in `keyserver` encryption mode, `503` means the database is up but the keyserver is unreachable (still counts as container-live — see the encryption runbook's "Keyserver outage" section).
- The SQLite schema is defined in `applyBaselineSchema()` in application code — the live 1.0.0 schema, applied idempotently on every boot. On startup the app also seeds observation type catalogue rows and runs any numbered migrations added after 1.0.0 (`schema_migrations`; empty as of 1.0.0). There is no long migration history maintained for pre-1.0.0 databases.
- Photos are stored at `<DB_PATH_DIR>/uploads/people/` and served via `/api/uploads/[filename]`. When `FC_ENCRYPTION_MODE` is `env` or `keyserver`, uploads are AES-256-GCM encrypted at rest (separate file key: `FC_FILE_KEY` / `FILE_WRAPPED_KEY`). Admins can inspect orphans under **Administration → Files**.
- Push reminders require VAPID keys and a cron trigger (`CRON_MODE=internal` or external `GET /api/cron`).

---

## Documentation

| Document | Audience | Purpose |
|---|---|---|
| This README | Operators and new contributors | Features, setup, env vars, roles, deployment |
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
