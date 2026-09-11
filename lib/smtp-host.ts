// SPDX-License-Identifier: AGPL-3.0-only

/**
 * SMTP host hardening: reject cloud-metadata and link-local destinations
 * that turn test-email into an SSRF oracle. Does **not** blanket-deny RFC1918 /
 * localhost — LAN SMTP relays are a supported self-host pattern.
 *
 * Pure string checks only (no Node `net`) so settings registry stays client-safe.
 */

const BLOCKED_SMTP_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata",
  "instance-data",
])

function looksLikeIpv4(host: string): boolean {
  const parts = host.split(".")
  if (parts.length !== 4) return false
  return parts.every(p => {
    if (!/^\d{1,3}$/.test(p)) return false
    const n = Number(p)
    return n >= 0 && n <= 255
  })
}

function looksLikeIpv6(host: string): boolean {
  // Enough to catch fe80:: / ::1 literals without pulling in Node `net`.
  return host.includes(":")
}

function isLinkLocalOrMetadataIp(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower.startsWith("fe80:")) return true

  if (!looksLikeIpv4(ip)) return false

  const parts = ip.split(".").map(Number)
  const [a, b] = parts
  // Link-local 169.254.0.0/16 (includes cloud IMDS 169.254.169.254)
  if (a === 169 && b === 254) return true
  // Azure WireServer
  if (a === 168 && b === 63 && parts[2] === 129 && parts[3] === 16) return true
  return false
}

/** True when the SMTP host string must not be dialled. */
export function isBlockedSmtpHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, "")
  if (!h) return true
  if (BLOCKED_SMTP_HOSTNAMES.has(h)) return true
  if (h.endsWith(".metadata.google.internal")) return true
  if ((looksLikeIpv4(h) || looksLikeIpv6(h)) && isLinkLocalOrMetadataIp(h)) return true
  return false
}

/** Registry validator: non-empty and not a blocked metadata/link-local host. */
export function isValidSmtpHost(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === "") return false
  return !isBlockedSmtpHost(trimmed)
}

export const GENERIC_EMAIL_SEND_ERROR = "Email could not be sent. Check your email settings and try again."
