# ADR-0007: Unified reverse-proxy deployment mode

**Status:** Accepted (2026-07-03)

## Context

Operators behind NPM, Cloudflare, or similar had to set `NEXTAUTH_USE_SECURE_COOKIES` separately from rate-limiter XFF handling (`TRUST_PROXY_DEPTH`). The original `TRUST_PROXY` boolean was never implemented.

## Decision

### `BEHIND_REVERSE_PROXY`

Single operator toggle (default `false` in code; **`true` in shipped compose and managed-hosting templates**).

When `true`:

- NextAuth `trustHost: true`
- Auth rate limiter uses `clientIpFromHeaders()` (XFF trusted-hop parsing)

When `false`:

- NextAuth `trustHost: false`
- Rate limiter returns `"unknown"` for IP (per-email cap still applies)

### Cookie `Secure` flag (superseded)

`useSecureCookies` is **no longer** derived from `BEHIND_REVERSE_PROXY`. The `Secure`
flag is a browser/public-connection concern — the browser evaluates it on the
public (HTTPS) hop, not the proxy→app hop — so disabling it behind a reverse proxy
that terminates TLS caused Auth.js cookies to ship without `Secure` in production
(ZAP 10011). `nextAuthUseSecureCookies()` now returns `true` whenever the app is not
running under `next dev`, regardless of `BEHIND_REVERSE_PROXY`.

### `TRUST_PROXY_DEPTH` (retained)

Separate env var — a security uplift from a prior audit, not folded into the boolean.

- Default `1` (single reverse proxy)
- Managed hosting sets `2` (two trusted proxy hops between the browser and the app)
- Ignored when `BEHIND_REVERSE_PROXY` is not `true`

### Migration

- `NEXTAUTH_USE_SECURE_COOKIES=false` implies `BEHIND_REVERSE_PROXY=true` when the new var is unset (one release).
- Remove `NEXTAUTH_USE_SECURE_COOKIES` from operator documentation.

## Implementation

- `lib/reverse-proxy.ts` — `isBehindReverseProxy()`, derived NextAuth flags
- `lib/client-ip.ts` — gates XFF parsing on `isBehindReverseProxy()`

## Consequences

- Managed hosting injects `BEHIND_REVERSE_PROXY=true` and `TRUST_PROXY_DEPTH=2` for its instances.
- Self-hosters with a two-hop proxy chain (e.g. Cloudflare in front of their own reverse proxy) set `TRUST_PROXY_DEPTH=2` manually (README's "Deployment notes" section).
