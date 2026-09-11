# ADR-0014: Managed admin forced-reset first-login flow

**Status:** Accepted — fully implemented
**Tracking:** Manual-provisioning admin pre-seed (internal issue tracker, familychart-admin)

## Context

[ADR-0002](0002-instance-setup-gate.md) established that managed instances get their admin account provisioned before the instance is reachable, with a random password, and that the self-host `/setup` wizard stays disabled under `FC_PLATFORM_PROFILE=managed`. It didn't specify how the admin ever learns that password or logs in for the first time — the account exists, but nothing lets its owner in.

The randomly-generated password is deliberately never transmitted (it's discarded after being written to the account row, per the tracked provisioning spec above). First login has to happen through some out-of-band credential the operator's email can carry — the mechanism worked out below.

> **Table name:** this ADR was written against `local_users`. Migration `017_accounts_unification` renamed that table to `accounts` ([ADR-0015](0015-accounts-unification.md)); `must_reset_password` lives on `accounts`. Historical mentions of `local_users` below mean that table.

This app is JWT-session-only ([lib/auth.ts](../../lib/auth.ts)) with no database adapter, so Auth.js's built-in Email/magic-link provider (which requires one, to persist verification tokens) isn't a drop-in option without adopting an adapter this app doesn't otherwise need.

## Decision

### Scope: managed first-login only

This flow exists solely to unblock the pre-seeded managed admin's first login. It is not a general "forgot password" feature for any local user — that would be a separate decision with its own product scope (should self-hosters get self-service password reset at all?). Self-hosters are entirely unaffected; they keep using `/setup`.

### `must_reset_password` flag, not a token table

A boolean column on `local_users` (alongside `session_version`, which already gates JWT validity per-user — see the `jwt` callback in `auth.ts`). Set `true` when the provisioner creates the account; cleared to `false` when the reset completes.

### Reset token: stateless, HMAC-signed — no new database table

`mintResetToken({ userId, exp, secret })` → `HMAC-SHA256(userId | exp | "password-reset")`, base64url-encoded, verified the same way on this side. No token-table, no cleanup job, no place for tokens to leak via a database dump.

- **Signing key**: derived from the instance's `NEXTAUTH_SECRET` via HKDF with `info: "password-reset"` — not the raw secret. Key separation means a bug in reset-token verification can't be leveraged against session JWTs, or vice versa.
- **Expiry**: 72 hours, embedded in the signed payload and checked at verification time. Long enough that an operator not opening the email same-day doesn't need a resend in the common case; short enough that an abandoned, unused link isn't a standing risk.
- **Single-use**: not tracked explicitly. Verification requires `must_reset_password` still be `true` for that user; once a reset succeeds and the flag flips to `false`, any other copy of the token — including one captured in a log somewhere — is permanently rejected. This is what makes single-use hold without a "used tokens" store.

**Minted on the familychart-admin side, not here** (see [Cross-repo consistency](#cross-repo-consistency-no-shared-package) below) — familychart-admin already stores each instance's `nextauth_secret` (internal mechanics — see `docs-internal/managed-hosting.md`) and derives the same HKDF key to mint tokens this app only ever verifies.

### Transport: URL fragment, not a query string

The email link is `https://{subdomain}.familychart.app/reset-password#token=<token>`. The `#...` fragment is never sent in the HTTP request — not to this app's server, not logged in any access log — and is excluded from the `Referer` header by spec. Client-side JS reads `window.location.hash` on page load and POSTs the token in the request body when submitting. This satisfies "don't log the token" and "don't leak it via Referer" structurally, not by remembering to configure something.

### Routes

- `app/reset-password/page.tsx` — reads the token from the fragment, presents new-password + confirm.
- `app/api/auth/reset-password/route.ts` (POST, `{ token, password, confirmPassword }`) — verifies HMAC + expiry + `must_reset_password === true`, bcrypt-hashes the new password (cost 12, matching `app/api/local-users/route.ts`), updates `local_users`, and returns the account's email on success. No session is issued by the route itself — this app has no precedent anywhere for a route handler minting a NextAuth session outside the credentials provider's own `authorize()` flow. Instead `app/reset-password/page.tsx` **auto-signs-in** immediately after a successful POST, by calling `next-auth/react`'s `signIn("credentials", { email, password, redirect: false })` client-side with the email the route returned and the password the user just chose — the same `fetch` → `signIn` sequence `app/setup/page.tsx` already uses after bootstrap succeeds. The user never sees `/login` or re-enters credentials, so this satisfies "no redirect to a separate login step" without introducing a new session-issuance mechanism. Possessing a valid token already stands in for proof of identity in this one-time flow, so re-entering the just-chosen password adds friction without a security benefit.

### No public "request a reset link" endpoint

The only way a token gets minted is server-side — at account-creation time, or an operator-triggered resend from familychart-admin (see below). There is no unauthenticated endpoint here that takes an email address and does anything, so there's no user-enumeration surface and nothing to rate-limit on this side.

### Resend / expired-link handling lives on the familychart-admin side

Since the token is stateless, minting a fresh one costs nothing — no old token needs invalidating first. familychart-admin handles resend and expired-link cases entirely on its own side (internal mechanics — see `docs-internal/managed-hosting.md`); this app is never involved in a resend.

### Email is sent by familychart-admin, not from inside the tenant

Rather than have the provisioning step inside the tenant container compose and send this email via the tenant's own `sendOutboundEmail`/Graph routing ([ADR-0004](0004-managed-platform-profile.md)'s `{HOST_ID}@familychart.app` mechanism), familychart-admin sends it directly from its own platform mail sender (internal mechanics — see `docs-internal/managed-hosting.md`).

Consequence: the tenant-side account-creation step only ever writes the `local_users` row — email, password hash, `must_reset_password = true`. It never sends mail. `lib/email-send.ts` / `lib/graph-mail.ts` need **no changes** for this feature.

### Cross-repo consistency: no shared package

The HMAC/HKDF scheme above must be implemented identically on both sides (familychart-admin mints, this app verifies) — a mismatch means every first-login link silently fails to verify. Two repos, no existing shared-package infrastructure between them, and the shared surface is genuinely tiny (two pure functions, ~30-40 lines).

Considered and rejected: a real shared npm package (`@wheelielabs/fc-reset-token` via GitHub Packages). It would need a new repo/publish workflow, private-registry auth wired into both consumers' CI, and turns any future algorithm change into three PRs with a live cross-version window instead of one. Disproportionate for this much shared code, unless this pattern recurs elsewhere.

**Chosen instead**: the algorithm is specified precisely enough (above) that both sides implement it independently, and **both repos carry the same known-answer test vector** (fixed `userId`/`exp`/secret → fixed expected token) in their respective test suites (`lib/reset-token.test.ts` here; the equivalent in familychart-admin). A silent algorithm drift fails a test loudly in CI on whichever side changed, rather than surfacing as "first-login links are broken" in production.

## Consequences

- [ADR-0002](0002-instance-setup-gate.md)'s Stage 1 table has been updated alongside this ADR to stop saying the admin is created "from Stripe-checkout email" — familychart-admin's manual-provisioning UI is the mechanism actually built; Stripe-checkout-triggered provisioning remains a distinct, not-yet-built follow-on (explicitly out of scope for this work).
- `docs-internal/managed-hosting.md`'s "Billing / provisioning flow" section needs the same correction — see that file's update alongside this ADR.
- A drift between this repo's and familychart-admin's token implementation is caught by matching known-answer test vectors in each repo's test suite, not by a shared dependency — if that ever proves insufficient (e.g. this pattern of shared crypto-adjacent logic recurs for other features), revisit the shared-package option above.
- No self-service "forgot password" exists for any other local user as a result of this work — that remains unbuilt, deliberately out of scope here.
