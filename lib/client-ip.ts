// SPDX-License-Identifier: AGPL-3.0-only

import { isBehindReverseProxy } from "@/lib/reverse-proxy"

/**
 * Trusted client-IP derivation for rate limiting.
 *
 * `X-Forwarded-For` is attacker-controlled on the left: a stock reverse proxy
 * (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`) *appends* the
 * connecting address, so the trustworthy client IP is the Nth entry counted from
 * the right, where N is the number of trusted proxy hops in front of the app.
 *
 * `TRUST_PROXY_DEPTH` (default 1, matching the documented single reverse proxy)
 * sets that hop count. Taking `xff[len - depth]` ignores any values the client
 * prepended, so rotating the header no longer mints a fresh rate-limit bucket.
 */
export function trustedProxyDepth(): number {
  const raw = process.env.TRUST_PROXY_DEPTH
  if (raw == null || raw.trim() === "") return 1
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

/** Headers-like accessor common to NextRequest and the Credentials authorize request. */
interface HeaderGetter {
  get(name: string): string | null
}

export function clientIpFromHeaders(
  headers: HeaderGetter,
  depth = trustedProxyDepth(),
): string {
  if (!isBehindReverseProxy()) return "unknown"

  const xff = headers.get("x-forwarded-for")
  if (xff) {
    const parts = xff.split(",").map(s => s.trim()).filter(Boolean)
    if (parts.length > 0) {
      const ip = parts[Math.max(0, parts.length - depth)]
      if (ip) return ip
    }
  }
  const real = headers.get("x-real-ip")?.trim()
  if (real) return real
  return "unknown"
}
