# ADR-0005: Demo mode platform guard and in-app moderation

## Status

Accepted — implemented in v0.43.0 (Wave 5)

## Context

Demo behaviour (fixed OTP `123456`, account-change blocks) was gated on `DEMO_MODE=true` alone. A self-hosted operator could copy that env var from compose templates and activate auth bypass locally. Moderation previously lived in the platform demo instance as a separate polling process triggering full DB reset — not reject-on-write (internal mechanics — see `docs-internal/managed-hosting.md`).

## Decision

### Platform guard

- Demo features arm only when **`DEMO_MODE=true` AND `FC_PLATFORM_PROFILE=demo`**.
- Self-host (no `FC_PLATFORM_PROFILE`): `DEMO_MODE` is **ignored** — no bypass, no account blocks, no profanity filter.
- Platform misconfiguration (`DEMO_MODE=true` with a non-demo profile): **fail fast at boot**.

`FC_PLATFORM_PROFILE=demo` is provisioner/platform-set and does not belong in self-host templates.

### In-app profanity filter

- Reject-on-write (HTTP 400) on enumerated free-text API paths when demo mode is armed.
- **Hybrid moderation:** trimmed local blocklist (slurs + severe profanity, ~18 terms, word-boundary match) then a batched [purgomalum.com](https://www.purgomalum.com) `containsprofanity` call (1s timeout, fail-open with `console.warn` on outage).
- Self-host and managed tenants: no purgomalum calls; local list is inert unless demo is armed.
- Non-demo builds include the local list inertly (no runtime cost until demo is armed).

### Demo image

- Platform demo instance's seed data synced to current schema; old polling sidecar removed (internal detail — see `docs-internal/managed-hosting.md`).
- Staging cutover checklist: [`docs/demo-staging-cutover.md`](demo-staging-cutover.md).

## Consequences

- Demo compose must set both `DEMO_MODE` and `FC_PLATFORM_PROFILE=demo`.
- Managed tenants (`FC_PLATFORM_PROFILE=managed`) cannot arm demo behaviour even if `DEMO_MODE` is mistakenly set.
- Public demo profanity handling is immediate 400 responses instead of delayed full reset.

## Related

- [ADR-0004](0004-managed-platform-profile.md) — `FC_PLATFORM_PROFILE` values
- Tracked across several scoped implementation issues in the dev backlog (platform guard, profanity filter, demo image regeneration, and staging cutover).
