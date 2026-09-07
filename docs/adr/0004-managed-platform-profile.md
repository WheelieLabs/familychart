# ADR-0004: Managed platform profile and modular auth

**Status:** Accepted — fully implemented  
**Tracking:** App UI Settings project (internal issue tracker)

## Context

Managed hosting needs a platform security floor (MFA, password policy, email/push ownership) that self-hosters can configure. Auth providers should be modular without disabling local credentials.

## Decision

### `FC_PLATFORM_PROFILE`

Env var selects managed policy profile (pins + hides security floor, enables platform email/push, etc.) or **`demo`** for the public demo instance. **Absent = self-host.**

### `platformLocked` settings

Under managed profile: MFA-required and password policy are pinned on and hidden — not overridable by tenant DB or env.

### Modular auth providers

Runtime provider list built from DB-enabled modules. **Local auth always-on, not configurable.** Entra config moves to `app_settings` (env-lockable via group env-lock). See [ADR-0001](0001-settings-registry.md).

### Managed email and push

- **Outbound email:** Microsoft Graph (client credentials, platform Entra app registration). Send as `{HOST_ID}@familychart.app` — mailbox must exist in M365 (login not required). **Self-host** uses SMTP (`FC_SMTP_*` registry). Managed instances receive `FC_GRAPH_MAIL_*` from the managed-hosting platform; no `FC_SMTP_*`.
- Per-instance VAPID in managed; self-host auto-generates keypair on first boot
- VAPID subject: managed = pinned platform contact, hidden; self-host = seeded from admin email

### Deployment context (Tier 0, provisioner-set)

`FC_PLATFORM_PROFILE`, instance ID (`HOST_ID`), and encryption mode are env/provisioner concerns — not tenant-editable registry entries.

## Consequences

- Managed hosting must inject admin account, email, push, and platform profile before instance is reachable.
- Managed-hosting provisioning mechanics (env injection, cross-repo `.env` writing) are internal — see `docs-internal/managed-hosting.md`.
