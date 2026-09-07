# ADR-0006: Environment variable inventory (ecosystem reconciliation)

**Status:** Accepted (2026-07-03)

## Context

Settings architecture (ADR-0001) splits configuration into env-only, registry-DB, and out-of-scope. Operators and provisioners need a single reconciled inventory across ecosystem repos. Wave 6 grilling (2026-07-03) settled `BEHIND_REVERSE_PROXY`, VAPID keys in registry, and Entra boot-seed behaviour.

## Classification key

| Class | Meaning |
|-------|---------|
| **env-only** | Stays in environment; not in `app_settings` |
| **registry-DB** | Typed registry entry (implemented or planned — see ADR-0001) |
| **deprecated** | Superseded; honoured for one release cycle |
| **out-of-scope** | Not operator configuration (build, framework, code constants) |
| **unplaced** | Needs human decision — none at audit time |

## This app's own environment variables

| Variable | Class | Notes |
|----------|-------|-------|
| `NEXTAUTH_SECRET` | env-only | Session encryption; boot validation |
| `NEXTAUTH_URL` | env-only | Public URL / OAuth callbacks |
| `BEHIND_REVERSE_PROXY` | env-only | Unified reverse-proxy mode: host trust, cookie Secure, XFF enablement |
| `TRUST_PROXY_DEPTH` | env-only | Trusted XFF hop count when behind proxy; default `1`; managed provisioner sets `2` |
| `NEXTAUTH_USE_SECURE_COOKIES` | deprecated | Derive from `!BEHIND_REVERSE_PROXY`; legacy `false` implies behind proxy |
| `ENABLED_AUTH_PROVIDERS` | deprecated | Boot-seeds `auth.entra.enabled` once; credentials always on |
| `AUTH_MICROSOFT_ENTRA_ID_ID` | registry-DB | `auth.entra.client_id`; group env-lock `auth.entra` |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | registry-DB | `auth.entra.client_secret` (secret) |
| `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID` | registry-DB | `auth.entra.tenant_id` |
| `ENTRA_GROUP_*` | env-only | RBAC group Object IDs; not tenant settings |
| `ENTRA_SESSION_MAX_AGE_MINUTES` | env-only | Entra session absolute lifetime |
| `DB_PATH` | env-only | SQLite path |
| `FC_PLATFORM_PROFILE` | env-only | `managed` \| `demo`; provisioner-set (ADR-0004, ADR-0005) |
| `DEMO_MODE` | env-only | Platform demo; requires `FC_PLATFORM_PROFILE=demo` |
| `VAPID_SUBJECT` | registry-DB | `push.vapid_subject` |
| `VAPID_PUBLIC_KEY` | registry-DB | `push.vapid_public_key`; env wins (managed provisioner) |
| `VAPID_PRIVATE_KEY` | registry-DB | `push.vapid_private_key` (secret) |
| `CRON_MODE` | env-only | `internal` vs external scheduler |
| `CRON_SECRET` | env-only | External cron auth |
| `FC_DEFAULT_TIMEZONE` | registry-DB | `locale.default_timezone` — **implemented** |
| `FC_MEASUREMENT_SYSTEM` | registry-DB | `locale.measurement_system` (`metric` \| `imperial`) — **implemented** |
| `FC_SCHEDULE_*` | registry-DB | `schedule.*` — **implemented** |
| `PUSH_OVERDUE_HOURS` | registry-DB | Legacy alias for overdue offset — **implemented** |
| `FC_MFA_REQUIRED` | registry-DB | `security.mfa_required` — **implemented** |
| `FC_PASSWORD_MIN_LENGTH` | registry-DB | `security.password_min_length` — **implemented** |
| `FC_SMTP_HOST` etc. | registry-DB | Self-host `email.smtp.*` only — **implemented** |
| `FC_GRAPH_MAIL_TENANT_ID` / `CLIENT_ID` / `CLIENT_SECRET` | env-only | Managed outbound mail via Graph; provisioner copies admin `ENTRA_*` |
| `HOST_ID` | env-only | Instance id; Graph From `{HOST_ID}@familychart.app` |
| `FC_ENCRYPTION_MODE` | env-only | Wave 7; also gates file-upload encryption |
| `FC_DB_KEY` / `DB_WRAPPED_KEY` / `DB_KS_*` | env-only | Wave 7 keyserver path |
| `FC_FILE_KEY` / `FILE_WRAPPED_KEY` | env-only | File-upload at-rest key; required when mode ≠ `none` |
| `NODE_ENV` | out-of-scope | Framework |
| `NEXT_RUNTIME` | out-of-scope | Next.js instrumentation |
| `FC_WHATS_NEW_PATH` / `FC_CHANGELOG_*` | out-of-scope | Build-time changelog script |

## Managed-hosting platform

This app is one component of a larger managed-hosting platform (provisioning, key management, monitoring). Those components maintain their own configuration surfaces, which are out of scope here — see `docs-internal/managed-hosting.md` for internal detail.

## Consequences

- README env table and `.env.local.example` follow this inventory.
- New settings use registry entries per ADR-0001; env-only list changes require ADR update.
