// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "@/lib/logger"

import NextAuth from "next-auth"
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id"
import Credentials from "next-auth/providers/credentials"
import { clientIpFromHeaders } from "@/lib/client-ip"
import { getDb } from "@/lib/db"
import { markAdminSeen } from "@/lib/setup-gate"
import { nextAuthTrustHost, nextAuthUseSecureCookies } from "@/lib/reverse-proxy"
import { parseLocalAccountUid } from "@/lib/account/account-uid"
import { isAdmin } from "@/lib/permissions"
import { refreshLocalUserSession } from "@/lib/local-user-session"
import { localAccountSignIn } from "@/lib/account/account-local-sign-in"
import { safeRelativeCallbackUrl } from "@/lib/safe-callback-url"
import {
  ensureAuthRevalidationRow,
  evaluateEntraSessionValidity,
  getAuthRevalidationStatus,
  resolveEntraJwtGroups,
} from "@/lib/auth/auth-revalidation"
import { isEntraProviderActive, resolveEntraCredentials } from "@/lib/settings/auth-settings"
import { matchOrCreateEntraAccount } from "@/lib/account/account-entra-match"

/**
 * Absolute (non-sliding) lifetime for Entra sessions, in ms.
 *
 * Entra account enablement is revalidated in the background; group claims
 * soft-refresh from `groups_json` when polled. This bound is the fail-safe
 * when polls have not succeeded recently — see ADR-0009.
 * Default 480 min (8 hours): long enough for a working day without mid-session
 * re-login, short enough that a failed poll path still bounds exposure.
 */
function entraSessionMaxAgeMs(): number {
  const raw = process.env.ENTRA_SESSION_MAX_AGE_MINUTES
  const n = raw != null ? parseInt(raw, 10) : NaN
  const minutes = Number.isFinite(n) && n >= 1 ? n : 480
  return minutes * 60_000
}

// The Entra provider is resolved per request (env-first, DB fallback — same
// precedence as `isEntraProviderActive`, which gates the login button) rather than
// fixed at module load from `process.env` alone. This is what makes a self-hoster's
// DB-only System Settings configuration (no env vars at all) actually work, not just
// correctly hide a broken button. See lib/settings/auth-settings.ts.
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const db = getDb()
  // Gate on isEntraProviderActive (also requires auth.entra.enabled), not just
  // resolved credentials — an admin can have valid saved credentials with the
  // provider explicitly turned off, and the login button and actual registration
  // must share that exact same condition.
  const entraCreds = isEntraProviderActive(db) ? resolveEntraCredentials(db) : null

  return {
  trustHost: nextAuthTrustHost(),
  useSecureCookies: nextAuthUseSecureCookies(),
  session: {
    maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
  },
  providers: [
    ...(entraCreds ? [MicrosoftEntraID({
      clientId:     entraCreds.clientId,
      clientSecret: entraCreds.clientSecret,
      issuer: `https://login.microsoftonline.com/${entraCreds.tenantId}/v2.0`,
    })] : []),
    Credentials({
      credentials: {
        email:    { label: "Email",    type: "email" },
        password: { label: "Password", type: "password" },
        otp:      { label: "OTP",      type: "text" },
      },
      async authorize(credentials, request) {
        const email    = (credentials?.email    as string | undefined)?.trim()
        const password = (credentials?.password as string | undefined)
        const otp      = (credentials?.otp      as string | undefined)?.trim()
        if (!email || !password) return null

        const ip = request?.headers ? clientIpFromHeaders(request.headers) : "unknown"
        const result = await localAccountSignIn(getDb(), { email, password, otp, ip })
        return result.ok ? result.session : null
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    // Defence-in-depth alongside the client-side safeRelativeCallbackUrl() check —
    // enforce the same same-origin-relative-path allow-list even if Auth.js's own default
    // redirect resolution ever changes.
    async redirect({ url, baseUrl }) {
      if (url.startsWith(baseUrl)) {
        const relative = url.slice(baseUrl.length) || "/"
        return baseUrl + safeRelativeCallbackUrl(relative)
      }
      try {
        const parsed = new URL(url)
        return baseUrl + safeRelativeCallbackUrl(parsed.pathname + parsed.search)
      } catch {
        return baseUrl + safeRelativeCallbackUrl(url)
      }
    },
    async jwt({ token, account, profile, user }) {
      if (account?.provider === "credentials") {
        delete token.entraOid
      }
      if (account && profile) {
        token.groups = (profile as { groups?: string[] }).groups ?? []
        if (profile.name) token.name = profile.name
        const p = profile as { email?: string; picture?: string; oid?: string }
        if (p.email) token.email = p.email
        if (p.picture) token.picture = p.picture
        if (account.provider === "microsoft-entra-id" && p.oid) {
          token.entraOid = p.oid
          token.sub = p.oid
          token.entraAuthAt = Date.now()
          // Ensure a tracking row exists so the hourly background poller (and
          // admin-triggered instant revoke) can act on this session; idempotent.
          try {
            ensureAuthRevalidationRow(getDb(), "entra", p.oid, {
              email: p.email ?? null,
              displayName: profile.name ?? null,
            })
          } catch (err) {
            logger.error("[auth] failed to ensure auth-revalidation row:", err)
          }
          // Claims a pending invite by email, or dedups/auto-creates an `accounts` row for
          // this Entra identity — bookkeeping only, never a source of access; Entra access
          // is governed entirely by group membership. Must never block sign-in on failure.
          try {
            matchOrCreateEntraAccount(getDb(), { oid: p.oid, email: p.email })
          } catch (err) {
            logger.error("[auth] failed to match/create Entra account:", err)
          }
        }
        // Record that an admin has authenticated so the unauthenticated bootstrap
        // window closes on mixed Entra+credentials instances even when no local admin is
        // ever created. Initial sign-in only (account+profile present); idempotent.
        if (
          account.provider === "microsoft-entra-id" &&
          isAdmin((profile as { groups?: string[] }).groups ?? [])
        ) {
          try {
            markAdminSeen(getDb())
          } catch (err) {
            logger.error("[auth] failed to record admin-seen sentinel:", err)
          }
        }
      }
      if (account?.provider === "credentials" && user) {
        token.groups = (user as { groups?: string[] }).groups ?? []
        token.sessionVersion = (user as { sessionVersion?: number }).sessionVersion ?? 0
      }

      // Returning null from the jwt callback invalidates the session: Auth.js clears the
      // session cookie (sessionStore.clean()) and auth()/req.auth resolve to null, so the
      // existing `if (!session) redirect("/login")` guards send the user back to the login
      // page instead of an "Access Denied" dead-end that requires a manual sign-out.
      const localId = parseLocalAccountUid(token.sub)
      if (localId != null) {
        const refreshed = refreshLocalUserSession(
          getDb(),
          localId,
          token.sessionVersion as number | undefined,
        )
        if (!refreshed) {
          logger.warn("session_revoked", {
            reason: "local_session_version",
            local_user_id: localId,
          })
          return null
        }
        token.groups = refreshed.groups
        token.sessionVersion = refreshed.sessionVersion
      }

      // Per-request Entra revocation check. `ENTRA_SESSION_MAX_AGE_MINUTES` is
      // repurposed from an unconditional forced-relogin timer into the fail-safe
      // bound: max time since the last *successful background revalidation* (or sign-in,
      // if never yet revalidated) before an interactive re-login is forced. An
      // admin-triggered or Graph-detected `revoked` status invalidates immediately,
      // with no Graph round-trip on the request path.
      if (token.entraOid) {
        const oid = token.entraOid as string
        const authAt = typeof token.entraAuthAt === "number" ? token.entraAuthAt : null
        let reval: ReturnType<typeof getAuthRevalidationStatus> = null
        try {
          reval = getAuthRevalidationStatus(getDb(), "entra", oid)
        } catch (err) {
          logger.error("[auth] auth-revalidation lookup failed:", err)
        }
        const valid = evaluateEntraSessionValidity({
          status: reval?.status ?? null,
          lastCheckedAt: reval?.lastCheckedAt ?? null,
          authAt,
          maxAgeMs: entraSessionMaxAgeMs(),
          nowMs: Date.now(),
        })
        if (!valid) {
          logger.warn("session_revoked", {
            reason: reval?.status === "revoked" ? "entra_revoked" : "entra_max_age",
            oid,
          })
          return null
        }
        // Soft-refresh role groups from poll cache when present. Null
        // groups_json (pre-first poll) leaves login-time IdP claims alone.
        // Empty/unmapped groups demote household role but keep personal-link
        // access — not a revoke. See ADR-0009.
        token.groups = resolveEntraJwtGroups(
          token.groups as string[] | undefined,
          reval?.groups ?? null,
        )
      }

      return token
    },
    async session({ session, token }) {
      const s = session as typeof session & {
        user?: typeof session.user & { id?: string; groups?: string[]; entraOid?: string | null }
        sessionVersion?: number
      }
      if (s.user) {
        s.user.id     = token.sub ?? ""
        s.user.groups = (token.groups as string[]) ?? []
        s.user.entraOid = (token.entraOid as string | undefined) ?? undefined
        if (token.name != null)  s.user.name  = token.name as string
        if (token.email != null) s.user.email = token.email as string
        if (token.picture != null) s.user.image = token.picture as string
      }
      if (token.sessionVersion != null) {
        s.sessionVersion = token.sessionVersion as number
      }
      return session
    },
  },
  }
})
