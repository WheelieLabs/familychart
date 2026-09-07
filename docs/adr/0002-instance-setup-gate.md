# ADR-0002: Two-stage instance setup gate

**Status:** Accepted — fully implemented  
**Tracking:** App UI Settings project (internal issue tracker)

## Context

First-run must differ between self-host (user creates admin) and managed SaaS (provisioner creates admin before the instance is reachable). A single `setup_complete` flag is insufficient without distinguishing admin existence from instance configuration.

## Decision

### Stage 1 — admin account exists

| Deployment | How |
|------------|-----|
| Self-host | First-run wizard at `/setup` creates the initial local admin |
| Managed | Admin account is provisioned by familychart-admin's provisioner, with a random password, **before** instance is reachable. Manual provisioning (via familychart-admin's UI) is the mechanism actually built; Stripe-checkout-triggered provisioning is a distinct, not-yet-built follow-on. First login is a forced-reset link, not the raw password — see [ADR-0014](0014-managed-admin-forced-reset-first-login.md) |

**Security rule:** Under `FC_PLATFORM_PROFILE=managed`, the create-admin flow is **never** served. Managed instance with no admin = provisioning failure → fail loud / refuse to serve.

Stage 1 is implemented via `accounts` (historically `local_users`; see [ADR-0015](0015-accounts-unification.md)) + existing `/setup` wizard (self-host).

### Stage 2 — instance configured

`setup_complete` sentinel in `system_config` via `isSetupComplete()` / `setSetupComplete()`. Absent → config wizard. Present → app.

Reconcile with existing proxy redirect to `/setup` until `setup_complete`.

### First-run wizard collects

| Deployment | Stage 1 | Stage 2 |
|------------|---------|---------|
| Self-host | Admin account, optional MFA enrollment, optional first person | Timezone (required) + SMTP (offer + skip) |
| Managed | (provisioner-injected) | Timezone; admin + email/push provisioner-injected |

## Proxy matcher and `/api/setup/*`

`proxy.ts` excludes the entire `/api/setup/*` prefix from the session and MFA-enrollment gates (setup-phase invariant, not a pre-session free-for-all). Routes under that prefix — including post-admin steps such as `complete` and `timezone` — must enforce their own auth (typically `requireAdmin()` → `resolveAuth()`, which re-loads the session). Keep the broad exclusion; when adding a new setup API route, do not assume proxy coverage.

## Consequences

- Managed path depends on [ADR-0004](0004-managed-platform-profile.md); managed-hosting provisioning mechanics are internal — see `docs-internal/managed-hosting.md`.
- First-login mechanism for the managed admin (forced-reset token, not the raw generated password) is [ADR-0014](0014-managed-admin-forced-reset-first-login.md).
- Future `/api/setup/*` routes inherit the matcher exclusion and must implement full auth themselves; this constraint is documented above.
