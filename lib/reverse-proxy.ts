// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reverse-proxy deployment mode.
 *
 * `BEHIND_REVERSE_PROXY` drives NextAuth host trust, session cookie Secure flag, and
 * whether X-Forwarded-For is used for auth rate limiting. `TRUST_PROXY_DEPTH` (default 1)
 * applies only when behind a proxy — see lib/client-ip.ts.
 *
 * Legacy: when `BEHIND_REVERSE_PROXY` is unset, `NEXTAUTH_USE_SECURE_COOKIES=false`
 * implies behind-proxy mode for one release cycle.
 */
export function isBehindReverseProxy(): boolean {
  const explicit = process.env.BEHIND_REVERSE_PROXY?.trim().toLowerCase()
  if (explicit === "true" || explicit === "1") return true
  if (explicit === "false" || explicit === "0") return false
  if (process.env.NEXTAUTH_USE_SECURE_COOKIES === "false") return true
  return false
}

/** Local `next dev` uses http://localhost — not covered by BEHIND_REVERSE_PROXY semantics. */
function isNextDevServer(): boolean {
  return process.env.NODE_ENV === "development"
}

export function nextAuthTrustHost(): boolean {
  if (isNextDevServer()) return true
  return isBehindReverseProxy()
}

/**
 * Secure cookie flag is a browser-facing HTTPS concern, not a proxy-hop concern
 * (ZAP 10011): the browser evaluates `Secure` on the public connection, which is
 * HTTPS whether or not a reverse proxy sits in front of the app. Decoupled from
 * `BEHIND_REVERSE_PROXY` — only `next dev` over plain HTTP disables it.
 */
export function nextAuthUseSecureCookies(): boolean {
  return !isNextDevServer()
}

/** Headers-like accessor common to NextRequest and other request wrappers. */
interface HeaderGetter {
  get(name: string): string | null
}

/**
 * Public origin for absolute links in outbound content (e.g. invite emails).
 *
 * `request.nextUrl.origin` reflects the connection the Next.js server itself sees — behind
 * a reverse proxy, or in a container binding `0.0.0.0`, that's the app's own bind address/port
 * (`http://0.0.0.0:3000`), not the URL the recipient can actually reach. Mirrors
 * `nextAuthTrustHost()`: when host trust applies, the proxy-set `X-Forwarded-*` headers
 * (falling back to `Host`) are authoritative, matching how Auth.js itself resolves the
 * callback URL. Otherwise `NEXTAUTH_URL` is already the operator-configured public URL
 * Auth.js relies on in that mode. `fallback` (typically `request.nextUrl.origin`) is used
 * only if neither source is available.
 */
export function publicOrigin(headers: HeaderGetter, fallback: string): string {
  if (nextAuthTrustHost()) {
    const host = headers.get("x-forwarded-host") ?? headers.get("host")
    if (host) {
      const proto = headers.get("x-forwarded-proto") ?? (isNextDevServer() ? "http" : "https")
      return `${proto}://${host}`
    }
  }

  const configured = process.env.NEXTAUTH_URL?.trim()
  if (configured) {
    try {
      return new URL(configured).origin
    } catch {
      // Malformed NEXTAUTH_URL — fall through to caller's fallback.
    }
  }

  return fallback
}
