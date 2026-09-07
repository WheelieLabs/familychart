# ADR-0001: Settings registry and env-wins precedence

**Status:** Accepted — fully implemented  
**Tracking:** App UI Settings project (internal issue tracker)

## Context

Hosted tenants cannot edit environment variables; self-hosters need full env control. Settings must live in either env vars or an in-app `app_settings` table with a single, predictable precedence model.

## Decision

### Precedence: env-wins + lock

If an env var is set, its value is authoritative and the corresponding UI control renders **disabled** and badged (“Managed via environment”). Never hidden. If env is absent, the DB value (registry) applies. If neither, the registry default applies. Uniform across the entire registry — no per-block exceptions.

### Provenance resolver

The resolver returns `{ value, source: 'env' | 'db' | 'default', locked }`. The UI is driven by `source`, never by re-deriving precedence.

### Single typed registry

Every DB-storable setting is declared once with: dotted key, explicit env var name (not derived by string transform), type/validation, scope, secret flag, and default. The registry drives the resolver, the generated settings UI, and validation. Adding a setting = one registry entry.

Validation lives in the registry — one code path for env and UI inputs. Invalid env fails loud at boot.

### `app_settings` table

```sql
app_settings(key TEXT, value TEXT, updated_at INTEGER, PRIMARY KEY (key))
```

Mirrors `user_settings`. Scope is not a column — tenant scope = this instance's DB; global scope = admin DB. The registry `scope` field tells the resolver which DB to read. Self-host collapses to one DB.

### Field properties

| Property | Behaviour |
|----------|-----------|
| `secret: true` | Write-only / set-status. Plaintext never returned by the settings API. UI shows set/not-set with Replace/Remove. Internal resolver reads real value server-side. Two distinct read paths — must never collapse (guard/test required). |
| `platformLocked` | Platform-mandated value; not rendered at all under managed profile. See [ADR-0004](0004-managed-platform-profile.md). |
| `setupStage: 'wizard' \| 'deferred'` | Collected in first-run wizard vs defaulted silently. Goal: shortest possible wizard. |
| Group env-lock | If any env var in a grouped setting (e.g. auth provider) is present, the whole group locks. |

### Registry entries (all implemented)

| Setting | Notes |
|---------|-------|
| Auth: Entra (enabled, client_id, tenant_id, client_secret) | **IMPLEMENTED** — `client_secret` secret; group env-lock; System Settings UI (`auth-entra` section). Local auth always-on. |
| MFA-required | **IMPLEMENTED** — env `FC_MFA_REQUIRED`. Self-host: editable via System Settings (`security` section). Managed: `platformLocked`. |
| Password policy | **IMPLEMENTED** — env `FC_PASSWORD_MIN_LENGTH`. Self-host: editable via System Settings (`security` section). Managed: `platformLocked`. |
| SMTP block | **IMPLEMENTED** — env `FC_SMTP_*`. Self-host: editable via System Settings (`email-smtp` section) with a send-test-email action; password secret. Managed: platform-owned, hidden (read-only "Outbound email — Managed via environment" card). |
| VAPID subject/keys | **IMPLEMENTED** — env `VAPID_SUBJECT`/`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`. Self-host: seeded from admin email / auto-generated, then editable via System Settings (`push` section). Managed: pinned, hidden. |
| `locale.default_timezone` | **IMPLEMENTED** — env `FC_DEFAULT_TIMEZONE`; audited writes; System Settings UI. |
| `locale.measurement_system` | **IMPLEMENTED** — env `FC_MEASUREMENT_SYSTEM` (`metric` \| `imperial`, default `metric`); default units on record form; display-layer conversion. |
| `schedule.lead_minutes` | **IMPLEMENTED** — env `FC_SCHEDULE_LEAD_MINUTES`; upcoming alert lead (default 60). |
| `schedule.overdue_offset_minutes` | **IMPLEMENTED** — env `FC_SCHEDULE_OVERDUE_OFFSET_MINUTES`; overdue push offset from slot time (default 30). Legacy env `PUSH_OVERDUE_HOURS` honoured when unset. |
| `schedule.slot_association_radius_minutes` | **IMPLEMENTED** — env `FC_SCHEDULE_SLOT_ASSOCIATION_RADIUS_MINUTES`; history dose-to-slot match (default 60). Push delivery width (30 min) is not a registry entry. |

### Env-only (not in registry)

Data dir/DB path; key-server URL (managed hosting only); `FC_ENCRYPTION_MODE`; `FC_DB_KEY`; session/NextAuth secret; bind address/port; app base URL; instance ID (`HOST_ID`); `DEMO_MODE`; logging/monitoring tokens; `BEHIND_REVERSE_PROXY`; `TRUST_PROXY_DEPTH`; `FC_PLATFORM_PROFILE`. See [ADR-0006](0006-environment-variable-inventory.md) and [ADR-0007](0007-reverse-proxy-mode.md).

### Out of scope — `user_settings` (per-user)

App-lock (WebAuthn); notification preferences; quiet hours; hydration pacing config.

### Not a setting

Observation type catalogue; medication grouping; push mechanics; data retention; backup; audit log; health endpoint; feature flags; edge infrastructure.

### Cross-cutting conventions

- **`email.available`** — derived boolean (managed → always true; self-host → true iff SMTP valid). Email features gate on it.
- **Settings-change auditing** — every `app_settings` write emits an audit entry. Secret fields audited as “changed”, never logging the value. (Wired as of PR-A.)
- **“Not a setting” is valid** — prefer good defaults / code constants where tuning has no real value.
- **Scope filter** — per-user concepts belong in `user_settings`, not this registry.

## Implementation (shipped)

- `app_settings` table, typed registry, provenance resolver (env-wins+lock)
- Generic `RegistrySettingsPanel` renders every section declared in `SETTINGS_UI_SECTIONS` (`lib/settings/ui-metadata.ts`) at `/admin/system-settings` — locale, medication schedule windows, Microsoft Entra, security policy (MFA/password), outbound email (SMTP), and push (VAPID) — with secret-field masking, env-lock badges, and group env-lock all working generically, not per-setting bespoke UI.
- `locale.default_timezone` / `FC_DEFAULT_TIMEZONE`, `locale.measurement_system` / `FC_MEASUREMENT_SYSTEM`, medication schedule windows (`schedule.*` / `FC_SCHEDULE_*`), Entra auth block, security policy (`FC_MFA_REQUIRED`, `FC_PASSWORD_MIN_LENGTH`), SMTP block (`FC_SMTP_*`, with send-test-email), and VAPID (subject + keys) are all live.

## Consequences

- Env var reconciliation across ecosystem repos is tracked separately in the dev backlog.
