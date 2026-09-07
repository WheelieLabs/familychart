import { auth } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { localUserNeedsMfaEnrollment } from "@/lib/account/account-local-reauth"
import { parseLocalAccountUid } from "@/lib/account/account-uid"
import { loadLocalUserSessionRow } from "@/lib/local-user-session"
import { isSessionExemptPage } from "@/lib/proxy-paths"
import { applySecurityHeaders } from "@/lib/security-headers"
import { isSetupComplete } from "@/lib/setup-gate"
import { NextResponse } from "next/server"

/** Sentinel only — open/read failures behave as incomplete (same as the old fetch catch). */
function readSetupComplete(): boolean {
  try {
    return isSetupComplete(getDb())
  } catch {
    return false
  }
}

/** Paths a local user may access before TOTP enrollment (enforced in Profile). */
function isMfaEnrollmentAllowedPath(pathname: string): boolean {
  return (
    pathname === "/setup" ||
    pathname === "/profile" ||
    pathname === "/api/me" ||
    pathname.startsWith("/api/me/") ||
    pathname.startsWith("/api/auth/")
  )
}

/**
 * Auth proxy for session + MFA-enrollment gates.
 *
 * `/api/setup/*` is excluded from the matcher (see `config.matcher` below). That
 * exclusion is a **setup-phase** invariant, not a pre-session free-for-all:
 * every route under `/api/setup/` must enforce its own auth (typically
 * `requireAdmin()` → `resolveAuth()`), because proxy session/MFA checks do not
 * run for those paths. Keep the broad exclusion; do not assume proxy coverage
 * when adding new setup routes.
 *
 * `lib/auth.ts` configures NextAuth with a config *function* (per-request DB-backed
 * Entra resolution). That makes `initAuth` wrap everything in an `async`
 * outer function, so `auth(handler)` resolves to a Promise<Handler> rather than a
 * Handler — calling it synchronously here would make this module's default export
 * a Promise, and Next.js requires the Proxy file's default export to be a function
 * (`ProxyMissingExportError` at runtime otherwise). Top-level await resolves it
 * once at module init; Next.js's proxy runtime always runs on Node.js, which
 * supports top-level await.
 */
const authProxy = await auth(async req => {
  const pathname = req.nextUrl.pathname
  const setupComplete = readSetupComplete()

  if (setupComplete && pathname === "/setup") {
    return applySecurityHeaders(NextResponse.redirect(new URL("/", req.url)))
  }

  if (!setupComplete) {
    if (!req.auth && !isSessionExemptPage(pathname)) {
      return applySecurityHeaders(NextResponse.redirect(new URL("/setup", req.url)))
    }
    if (req.auth && pathname !== "/setup" && !pathname.startsWith("/api/")) {
      return applySecurityHeaders(NextResponse.redirect(new URL("/setup", req.url)))
    }
  }

  if (!req.auth && !isSessionExemptPage(pathname)) {
    if (pathname.startsWith("/api/")) {
      return applySecurityHeaders(
        NextResponse.json({ error: "Unauthorised" }, { status: 401 })
      )
    }
    const signInUrl = new URL("/login", req.url)
    signInUrl.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search)
    return applySecurityHeaders(NextResponse.redirect(signInUrl))
  }

  const session = req.auth
  if (session?.user?.id) {
    const localId = parseLocalAccountUid(session.user.id)
    if (localId != null) {
      try {
        const db = getDb()
        const row = loadLocalUserSessionRow(db, localId)
        if (!row?.is_active) {
          const signInUrl = new URL("/login", req.url)
          signInUrl.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search)
          return applySecurityHeaders(NextResponse.redirect(signInUrl))
        }
        if (localUserNeedsMfaEnrollment(db, localId)) {
          if (!isMfaEnrollmentAllowedPath(pathname)) {
            if (pathname.startsWith("/api/")) {
              return applySecurityHeaders(
                NextResponse.json(
                  { error: "MFA enrollment required", code: "mfa_enrollment_required" },
                  { status: 403 },
                ),
              )
            }
            return applySecurityHeaders(
              NextResponse.redirect(new URL("/profile?tab=account", req.url)),
            )
          }
        }
      } catch (err) {
        console.error("[proxy] MFA enrollment check failed:", err)
        const signInUrl = new URL("/login", req.url)
        signInUrl.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search)
        return applySecurityHeaders(NextResponse.redirect(signInUrl))
      }
    }
  }

  return applySecurityHeaders(NextResponse.next())
})

export default authProxy

export const config = {
  matcher: [
    "/((?!api/auth|api/setup|api/health|api/version|api/push/vapid-public-key|api/cron|login|denied|_next/static|_next/image|favicon.ico|manifest.json|icons|sw.js|sw-push.js|push-notification-actions.js|workbox-.*).*)"
  ]
}
