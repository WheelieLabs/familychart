// SPDX-License-Identifier: AGPL-3.0-only

import dns from "dns/promises"
import https from "https"
import { isIP } from "net"

/** Host suffixes for known Web Push services (HTTPS only). */
const ALLOWED_PUSH_HOST_SUFFIXES = [
  ".googleapis.com",
  ".push.services.mozilla.com",
  ".notify.windows.com",
  ".push.apple.com",
  ".push.apple.com.",
  "wns.windows.com",
  "notify.windows.com",
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
] as const

function isPrivateOrReservedIp(ip: string): boolean {
  if (ip === "::1" || ip === "0:0:0:0:0:0:0:1") return true
  if (ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return true

  if (!isIP(ip)) return false
  if (isIP(ip) === 6) return false

  const parts = ip.split(".").map(Number)
  if (parts.length !== 4) return false
  const [a, b] = parts
  if (a === 10) return true
  if (a === 127) return true
  if (a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

function hostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "")
  if (host === "localhost") return false
  return ALLOWED_PUSH_HOST_SUFFIXES.some(
    suffix => host === suffix.replace(/^\./, "") || host.endsWith(suffix),
  )
}

async function resolveHostAddresses(hostname: string): Promise<string[]> {
  if (isIP(hostname)) return [hostname]
  const results = await dns.lookup(hostname, { all: true, verbatim: true })
  return results.map(r => r.address)
}

/** Validate a push subscription endpoint URL before storage. */
export async function validatePushEndpoint(endpoint: string): Promise<string | null> {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return "Invalid push endpoint URL"
  }
  if (url.protocol !== "https:") {
    return "Push endpoint must use HTTPS"
  }
  if (url.username || url.password) {
    return "Push endpoint must not include credentials"
  }
  if (!hostAllowed(url.hostname)) {
    return "Push endpoint host is not an allowed push service"
  }

  try {
    const addresses = await resolveHostAddresses(url.hostname)
    if (addresses.length === 0) return "Push endpoint host could not be resolved"
    for (const address of addresses) {
      if (isPrivateOrReservedIp(address)) {
        return "Push endpoint resolves to a private or reserved address"
      }
    }
  } catch {
    return "Push endpoint host could not be resolved"
  }

  return null
}

/** HTTPS agent that re-checks resolved IPs at connect time (DNS rebinding guard). */
export function createPushHttpsAgent(): https.Agent {
  return new https.Agent({
    lookup: (hostname, options, callback) => {
      dns
        .lookup(hostname, { ...(options as object), all: true, verbatim: true })
        .then(results => {
          const list = Array.isArray(results) ? results : [results]
          const normalised = list.map(entry =>
            typeof entry === "string"
              ? { address: entry, family: isIP(entry) === 6 ? 6 : 4 }
              : entry,
          )
          for (const entry of normalised) {
            if (isPrivateOrReservedIp(entry.address)) {
              callback(new Error("Blocked push endpoint address"), "", 0)
              return
            }
          }
          // Honour the caller's `all` contract. Node's Happy Eyeballs
          // (autoSelectFamily, default-on in Node >= 20) invokes lookup with
          // `all: true` and expects an array of { address, family } back.
          // Collapsing to a single address there yields
          // "Invalid IP address: undefined" and every push send fails to
          // connect — silently breaking notifications, including the test send.
          if ((options as { all?: boolean })?.all) {
            callback(null, normalised)
            return
          }
          const first = normalised[0]
          if (!first) {
            callback(new Error("No addresses"), "", 0)
            return
          }
          callback(null, first.address, first.family)
        })
        .catch(err => {
          callback(err instanceof Error ? err : new Error(String(err)), "", 0)
        })
    },
  })
}

export const PUSH_REQUEST_TIMEOUT_MS = 10_000
