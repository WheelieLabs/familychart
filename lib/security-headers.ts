// SPDX-License-Identifier: AGPL-3.0-only

import type { NextResponse } from "next/server"

/**
 * Single source of truth for defence-in-depth security headers.
 * Consumed two ways so coverage isn't matcher-dependent:
 *  - `applySecurityHeaders()` — proxy.ts, for routes it intercepts
 *  - `SECURITY_HEADERS` — next.config.ts `headers()`, for routes the proxy matcher
 *    excludes but that still serve app HTML/JSON (`/login`, `/denied`, `/manifest.json`)
 *
 * `unsafe-inline` / `unsafe-eval` remain in `script-src` for Next.js production
 * hydration and framework runtime (investigated separately — nonce/hash migration
 * deferred as a dedicated follow-up). COEP/CORP are
 * deliberately left unset (wontfix) — they break normal cross-origin asset/
 * embedding behaviour this app relies on and ZAP/Nuclei flag their absence only as
 * a WARN, not a FAIL.
 *
 * COOP (unlike COEP/CORP) doesn't gate cross-origin asset loading — it only
 * isolates the top-level browsing context group — so it's safe to set even
 * though the Entra ID sign-in flow is redirect-based (no `window.opener` /
 * `postMessage` popup handshake to break).
 *
 * `base-uri` / `form-action` / `object-src` are set explicitly because,
 * unlike `script-src`/`style-src`/`img-src`/etc., they never inherit from
 * `default-src` per the CSP spec — omitting them left those vectors unrestricted
 * even with `default-src 'self'` set.
 */
export const SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
]

export function applySecurityHeaders(response: NextResponse): NextResponse {
  for (const { key, value } of SECURITY_HEADERS) {
    response.headers.set(key, value)
  }
  return response
}
