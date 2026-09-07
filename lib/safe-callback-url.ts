// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Allow-list same-origin relative paths only. Auth.js's default `redirect` callback
 * already resolves cross-origin `callbackUrl` values back to `baseUrl` (ZAP
 * 10031), but a bare `startsWith('/')` check does not: `//evil.com` is a valid
 * scheme-relative URL a browser will follow off-origin. Reject anything that isn't
 * a single-leading-slash path.
 */
export function safeRelativeCallbackUrl(
  callbackUrl: string | null | undefined,
  fallback = "/",
): string {
  if (!callbackUrl) return fallback
  if (!callbackUrl.startsWith("/")) return fallback
  if (callbackUrl.startsWith("//")) return fallback
  if (callbackUrl.startsWith("/\\")) return fallback
  return callbackUrl
}
