// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useState } from "react"

/** Read `#token=...` from the URL fragment — never a query string, so the token is never sent
 * to the server in the initial request, never logged, and excluded from Referer headers. */
function readTokenFromFragment(): string | null {
  if (typeof window === "undefined") return null
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash
  return new URLSearchParams(hash).get("token")
}

/**
 * Reads a one-time token out of the URL fragment on mount and immediately strips it from
 * history, so it never lingers in the visible URL. `undefined` means "not read yet"
 * (avoids a flash of the invalid-token state before the effect runs); `null` means the
 * fragment had no token.
 */
export function useTokenFromFragment(): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    setToken(readTokenFromFragment())
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname)
    }
  }, [])

  return token
}
