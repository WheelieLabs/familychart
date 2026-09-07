# ADR-0009: Entra live revocation (background revalidation + admin instant revoke)

**Status:** Accepted — v0.51.0

## Context

Local users already have **instant** revocation: `refreshLocalUserSession` re-derives role/`is_active` per request and a `session_version` bump kills live sessions immediately. Entra users did not — FamilyChart never re-read Azure group/account state mid-session, so an earlier fix settled for a coarse mitigation: an absolute session lifetime (`ENTRA_SESSION_MAX_AGE_MINUTES`, default 480 = 8h) that forced periodic interactive re-auth, at which point group claims and account status were re-read.

Entra ID auth is **not** supported on Managed FamilyChart hosting — it is for personal-instance use and opt-in self-hosters who run their own Azure AD tenant and accept responsibility for its setup. The primary driver here is UX (removing the forced daily interactive re-login), not an unattended-offboarding security backstop.

**Ruled out:** per-request Graph re-validation, and a request-triggered-TTL flavor of cached revalidation. No user request should ever wait on or trigger a live Graph call — the `jwt` callback (`lib/auth.ts`) is a hot path, and there was previously zero Graph SDK/permission grant in the app.

## Decision

### Mechanism

- **Background poller** — a 5th job in the existing cron dispatcher (`lib/cron.ts` `runCronJobs()`), self-gated via `shouldPollAuthRevalidation()` to run hourly (`lib/auth-revalidation.ts`). It ticks on the same 5-minute interval as the other jobs but no-ops otherwise. Works under both `CRON_MODE=internal` and `external`.
- **Admin-triggered instant revoke** — `POST /api/admin/entra-sessions/[oid]/revoke`, surfaced at `/admin/entra-sessions`. Zero Graph dependency; takes effect on the victim's next request. Also **prunes Web Push** subscriptions for that OID; Graph-detected disable does the same via `revokedExternalIds` returned to cron.
- **Admin revoke vs Graph poll (Entra remains source of truth)** — Admin revoke is an **immediate kill-switch bridging poll lag**, not a FamilyChart-side ban independent of Entra. Intent: drop interactive PHI access (and push) right away when an operator knows Entra state has changed (or is about to) but the hourly Graph poll has not yet run. The next successful poll that sees `accountEnabled: true` **may restore** `status = 'ok'` and soft-refresh groups — that reconciliation is correct. Do **not** CAS-block poll `ok` writes against `revoked` rows; that would make FamilyChart a second access-control system. Sticky FC-only bans / explicit re-enable are out of scope (closed as intentional behaviour, not a defect).
- **Live group claims** — after a successful poll writes non-null `groups_json`, the `jwt` callback **soft-refreshes** `token.groups` from that cache on each request. Pre-first-poll rows keep `groups_json` null and leave login-time IdP claims alone. Empty/unmapped groups demote household role but do **not** equate to `revoked`; personal-link access remains. Cron push delivery uses the same poll cache via `pushSubscriberStillAuthorised`.
- **Storage** — generic table `auth_revalidation_status(provider, external_id, status, last_checked_at, groups_json, email, display_name, updated_at)`, not Entra-specific, to compose with a future modular/DB-driven auth-provider design. The `jwt` callback does a provider-agnostic lookup (`getAuthRevalidationStatus`), the same pattern as `session_version` for local users. A row is created (`ensureAuthRevalidationRow`) on Entra sign-in.
- **`ENTRA_SESSION_MAX_AGE_MINUTES` repurposed** — no new env var. Meaning changes from "unconditionally force re-login every N minutes" to "max time since last successful revalidation before forcing interactive re-login" (the fail-safe bound). The existing 480min default carries over as the fail-safe default. See `evaluateEntraSessionValidity()` for the pure decision function (unit-tested independent of next-auth).
- **Outage behavior** — a single failed poll attempt (per-user Graph error) is fail-open: the row is left untouched (retried next successful poll cycle), no user impact. `pollEntraRevalidation()` still marks the poll cycle attempted so a systemic outage (e.g. token endpoint down) doesn't wedge the hourly gate waiting on one user's error — the repurposed env var is the only eventual forcing mechanism if failures persist across many cycles.
- **Feature is opt-in** — `loadEntraGraphConfig()` in `lib/entra-graph-token.ts` deliberately reads only the *env-sourced* Entra sign-in app credentials (`AUTH_MICROSOFT_ENTRA_ID_ID`/`_SECRET`/`_TENANT_ID`), independent of the env-or-DB precedence used for the sign-in provider itself (see [ADR-0010](0010-entra-provider-request-scoped-config.md)). This is a narrower, intentional choice for the Graph client specifically: the same app registration also requires an additional Graph app-only permission grant (`User.Read.All` + `GroupMember.Read.All`), and env is the simpler place to reason about "has this operator actually granted the extra Graph permission" for a background job. Self-hosters who haven't granted it still get correctly-functioning Entra sign-in (env or DB); the poller simply has nothing to check (`pollEntraRevalidation` no-ops when `loadEntraGraphConfig()` returns null) and sessions fall back to the fail-safe bound measured from sign-in time. App-only Graph tokens are owned by that module (`getAppOnlyGraphToken`) and shared with access-control membership listing; managed Graph mail (`lib/graph-mail.ts`) stays on separate credentials.

### Net effect

With hourly background revalidation, `ENTRA_SESSION_MAX_AGE_MINUTES` can be lengthened substantially (days) without widening real revocation exposure — solving the daily-re-login annoyance while keeping admin-triggered revocation instant.

## Consequences

- New table `auth_revalidation_status` (migration `015_auth_revalidation_status`).
- New admin surface: `/admin/entra-sessions` (linked from `/admin/overview` only when `isEntraProviderActive()`).
- Self-hosters who want live Graph-based revalidation must grant `User.Read.All` + `GroupMember.Read.All` (app-only) on their Entra app registration — documented in README's environment-variable table and this ADR. Sign-in itself needs no new permission.
- The generic `(provider, external_id)` shape is intentionally reusable for a future non-Entra federated provider.

## References

- Local-user `session_version` revocation — the pattern this generalizes
- Entra absolute session lifetime — the mechanism repurposed here
- [ADR-0010](0010-entra-provider-request-scoped-config.md) — Entra config env-vs-DB reconciliation (unifies the sign-in provider's credential source; the Graph revalidation client above is deliberately narrower, env-only)
