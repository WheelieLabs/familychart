// SPDX-License-Identifier: AGPL-3.0-only

"use client"

/**
 * PWA deploy freshness.
 *
 * Polls GET /api/version (server package.json) and reloads when it differs from
 * the baked client APP_VERSION so What's New and footer version stay aligned after
 * a deploy. Push notifications use sw-push.js only — no app-shell service worker.
 *
 * Reload is rate-limited via sessionStorage to avoid tight loops if a CDN edge
 * still serves a stale JS bundle immediately after reload.
 */

import { useEffect } from "react"
import { APP_VERSION } from "@/lib/version"

const RELOAD_GUARD_KEY = "fc-deploy-reload-at"
const DEMO_VERSION_SEEN_KEY = "fc-demo-version-seen"
const RELOAD_COOLDOWN_MS = 30_000

async function maybeReloadForNewDeploy(): Promise<void> {
  try {
    const res = await fetch("/api/version", { cache: "no-store" })
    if (!res.ok) return
    const data = (await res.json()) as { version?: string; demoVersion?: string }

    const appChanged = !!data.version && data.version !== APP_VERSION

    // Demo-assets-only republishes don't move APP_VERSION, so track the last-seen
    // demoVersion separately — otherwise an open tab keeps showing a stale badge.
    const lastSeenDemoVersion = sessionStorage.getItem(DEMO_VERSION_SEEN_KEY)
    const demoChanged =
      !!data.demoVersion && lastSeenDemoVersion !== null && data.demoVersion !== lastSeenDemoVersion
    if (data.demoVersion) sessionStorage.setItem(DEMO_VERSION_SEEN_KEY, data.demoVersion)

    if (!appChanged && !demoChanged) return

    const lastReload = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? "0")
    if (Date.now() - lastReload < RELOAD_COOLDOWN_MS) return

    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()))
    window.location.reload()
  } catch {
    // Offline or transient error — try again on next visibility change.
  }
}

export default function DeployRefresh() {
  useEffect(() => {
    void maybeReloadForNewDeploy()

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void maybeReloadForNewDeploy()
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => document.removeEventListener("visibilitychange", onVisibilityChange)
  }, [])

  return null
}
