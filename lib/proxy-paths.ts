// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pages (and their unauthenticated API routes) the auth proxy allows without a session.
 *
 * `/login` and `/denied` are excluded from the proxy matcher entirely, as is all of
 * `/api/auth/*` (see `proxy.ts`'s `config.matcher`) — that's how the managed-admin
 * reset-password API route avoids the proxy's session gate. The invite-accept API
 * lives under `/api/accounts/invites/`, which is *not* broadly exempt (most of that
 * tree is admin-only), so its accept endpoint needs its own explicit entry here
 * alongside the page — otherwise `proxy.ts` 401s it before the route handler runs.
 *
 * `/setup`, `/reset-password`, and `/accept-invite` stay in the matcher (security
 * headers still apply) but must not bounce an unauthenticated visitor to login or
 * setup — the managed-admin first-login link and the invite-acceptance link both
 * land with the token in the URL fragment, which a redirect would drop.
 */
export function isSessionExemptPage(pathname: string): boolean {
  return (
    pathname === "/setup" ||
    pathname === "/reset-password" ||
    pathname === "/accept-invite" ||
    pathname === "/api/accounts/invites/accept"
  )
}
