# ADR-0010: Entra provider resolved from request-scoped NextAuth config

**Status:** Accepted — v0.51.1 (correcting a v0.51.0 same-day fix)

## Context

`app_settings` already let a self-hoster configure Entra entirely through System Settings (`auth.entra.enabled` + client/tenant/secret, all DB-backed and env-lockable — see [ADR-0001](0001-settings-registry.md)). But `lib/auth.ts` constructed the NextAuth `MicrosoftEntraID` provider once, at module load, straight from `process.env.AUTH_MICROSOFT_ENTRA_ID_*` — never reading `app_settings`. The login-button visibility check (`isEntraProviderActive`), by contrast, resolved credentials via `resolveSetting` (env-first, DB fallback), so it could say "active" for a DB-only configuration that the actual provider construction could never see. Result: a self-hoster who configured Entra purely through the UI got a visible sign-in button that led to a broken/no-op sign-in, because the provider itself was constructed with `undefined` credentials.

Two ways to close the gap were considered:
1. Make the provider honour DB config too — the same source the button already trusts.
2. Make the login button as strict as the provider (env-only) instead, and treat the DB-editable credential fields as advisory/no-op unless env is also set.

## Decision

**Option 1.** Registering the provider from `process.env` only would have quietly removed a capability the settings registry was explicitly built to support (DB-only self-hosted Entra configuration), and env-locking already exists for operators who want config to come from env specifically (`resolveSetting` marks env-sourced values `locked: true` and env always wins when both are set).

### Mechanism

`NextAuth()` (Auth.js v5 beta) accepts either a static config object or a function returning one: `NextAuth((request) => Awaitable<NextAuthConfig>)`. `lib/auth.ts` now uses the function form. On each invocation it calls `getDb()` and `isEntraProviderActive(db)` — the exact same function the login button uses — and only when that's true does it resolve credentials via `resolveEntraCredentials(db)` (env-first, DB fallback, same precedence as every other registry setting) to construct the `MicrosoftEntraID` provider. The login button and the actual provider registration can no longer disagree, because they share one source of truth.

### Restart semantics

This app already runs its middleware (`proxy.ts`) with direct `getDb()` / better-sqlite3 access per request — not Edge Runtime — so calling `getDb()` inside the NextAuth config function is the same pattern already in production use, not a new capability class. **Changing Entra settings in System Settings takes effect on the next request with no process restart required**, closing the "restart semantics" caveat raised as a caution during triage: the config function re-resolves credentials every time NextAuth needs them, so there's no cached/stale provider object to invalidate.

## Consequences

- `lib/settings/auth-settings.ts` gained `resolveEntraCredentials(db): EntraCredentials | null` — the canonical, testable (DB-only, no next-auth import) resolution used by both the button gate and the provider.
- `isEntraProviderActive(db)` reverted to its original simple form (`isEntraAuthEnabled(db) && entraCredentialsConfigured(db)`) — the earlier v0.51.0 change that additionally required the legacy `ENABLED_AUTH_PROVIDERS` env var was itself a step in the wrong direction (Option 2) and is superseded by this ADR.
- The Entra Graph *revalidation* client ([ADR-0009](0009-entra-live-revocation.md)) deliberately stays env-only — a narrower, separate decision, since it needs an additional Graph permission grant or the same app registration and env is the simpler explicit signal that an operator has granted it.

## References

- Original bug report and triage (Option 1 vs Option 2 framing): DB-stored settings gated the login button's visibility while the provider itself only read env, producing a visible-but-broken sign-in on DB-only configuration.
- [ADR-0001](0001-settings-registry.md) — settings registry, env-wins precedence
- [ADR-0009](0009-entra-live-revocation.md) — Entra live revocation (the Graph revalidation client's narrower env-only credential source)
