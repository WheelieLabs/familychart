import type { NextConfig } from "next"
import { SECURITY_HEADERS } from "@/lib/security-headers"

/** Native addons must not be bundled — Turbopack/webpack hash or duplicate-load breaks dlopen. */
const NATIVE_SERVER_PACKAGES = ["better-sqlite3-multiple-ciphers", "web-push"] as const

function nativePackageExternal(
  { request }: { request?: string },
  callback: (err?: Error | null, result?: string) => void,
) {
  if (!request) return callback()
  if ((NATIVE_SERVER_PACKAGES as readonly string[]).includes(request)) {
    return callback(null, `commonjs ${request}`)
  }
  const hashed = /^(.+)-[0-9a-f]{16}$/.exec(request)
  if (hashed && (NATIVE_SERVER_PACKAGES as readonly string[]).includes(hashed[1]!)) {
    return callback(null, `commonjs ${hashed[1]}`)
  }
  callback()
}

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [...NATIVE_SERVER_PACKAGES],
  poweredByHeader: false,
  webpack: (config, { isServer }) => {
    if (isServer) {
      const externals = config.externals
      if (Array.isArray(externals)) {
        externals.push(nativePackageExternal)
      } else if (typeof externals === "function") {
        config.externals = [externals, nativePackageExternal]
      } else {
        config.externals = [nativePackageExternal]
      }
    }
    return config
  },
  /** Allow production `next build` (Turbopack) alongside dev-only webpack externals above. */
  turbopack: {},
  /**
   * proxy.ts applies SECURITY_HEADERS via its matcher, which excludes `login`, `denied`,
   * and `manifest.json` (auth-gate/static-asset exclusions unrelated to header coverage).
   * Those routes still serve app HTML/JSON that scanners reach directly,
   * so mirror the same header set here from the shared module.
   */
  async headers() {
    const staticAssetHeaders = SECURITY_HEADERS.filter(({ key }) =>
      key === "X-Content-Type-Options" || key === "Permissions-Policy"
    )
    return [
      { source: "/login", headers: [...SECURITY_HEADERS] },
      { source: "/denied", headers: [...SECURITY_HEADERS] },
      {
        source: "/manifest.json",
        headers: [...SECURITY_HEADERS, { key: "Cache-Control", value: "public, max-age=3600" }],
      },
      // Full CSP/frame-ancestors set is meaningless noise on a .js/.css asset response —
      // only the two headers that matter for a raw asset fetch.
      { source: "/_next/static/:path*", headers: staticAssetHeaders },
    ]
  },
  async redirects() {
    // Legacy `/admin/*` URLs from before routes moved under `/management/*`.
    // Also unwind poisoned URLs from removed `/:personId/medications` redirects:
    // browsers may still cache a permanent 308 from `/management/medications` →
    // `/management/schedules-goals?tab=medications` (personId="management" → 404).
    return [
      {
        source: "/management/schedules-goals",
        has: [{ type: "query", key: "tab", value: "medications" }],
        destination: "/management/medications?tab=medications",
        permanent: false,
      },
      {
        source: "/management/schedules-goals",
        has: [{ type: "query", key: "tab", value: "observations" }],
        destination: "/management/observation-types",
        permanent: false,
      },
      {
        source: "/management/schedules-goals",
        destination: "/management/medications",
        permanent: false,
      },
      {
        source: "/admin/people",
        destination: "/management/people",
        permanent: true,
      },
      {
        source: "/admin/import",
        destination: "/management/import",
        permanent: true,
      },
      {
        source: "/admin/medications",
        destination: "/management/medications?tab=medications",
        permanent: true,
      },
      {
        source: "/admin/medication-groups",
        destination: "/management/medications?tab=groups",
        permanent: true,
      },
    ]
  },
}

export default nextConfig