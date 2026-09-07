// SPDX-License-Identifier: AGPL-3.0-only

import { isManagedPlatformProfile } from "@/lib/platform-profile"

export interface GraphMailConfig {
  tenantId: string
  clientId: string
  clientSecret: string
  fromAddress: string
}

let tokenCache: { token: string; expiresAt: number } | null = null

/** Managed instances: platform Graph app creds provisioned externally at instance setup. */
export function graphMailConfigured(): boolean {
  if (!isManagedPlatformProfile()) return false
  return loadGraphMailConfig() !== null
}

export function managedMailFromAddress(): string {
  const hostId =
    process.env.HOST_ID?.trim() ||
    process.env.INSTANCE_SUBDOMAIN?.trim()
  if (!hostId) {
    throw new Error("HOST_ID is required for managed outbound email")
  }
  return `${hostId}@familychart.app`
}

export function loadGraphMailConfig(): GraphMailConfig | null {
  if (!isManagedPlatformProfile()) return null

  const tenantId = process.env.FC_GRAPH_MAIL_TENANT_ID?.trim()
  const clientId = process.env.FC_GRAPH_MAIL_CLIENT_ID?.trim()
  const clientSecret = process.env.FC_GRAPH_MAIL_CLIENT_SECRET?.trim()
  if (!tenantId || !clientId || !clientSecret) return null

  return {
    tenantId,
    clientId,
    clientSecret,
    fromAddress: managedMailFromAddress(),
  }
}

async function getAccessToken(cfg: GraphMailConfig): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token
  }

  const res = await fetch(
    `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    },
  )

  if (!res.ok) {
    throw new Error(`Graph token request failed (${res.status}): ${await res.text()}`)
  }

  const data = (await res.json()) as { access_token: string; expires_in: number }
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  return tokenCache.token
}

export async function sendGraphMail(
  cfg: GraphMailConfig,
  opts: { to: string; subject: string; text: string; html?: string },
): Promise<void> {
  const token = await getAccessToken(cfg)

  // Graph's JSON `sendMail` body carries exactly one contentType/content pair — no true
  // multipart/alternative in this mode. HTML wins when present; `text` is only used as a
  // fallback, not sent alongside HTML as a separate part. True Graph-side multipart would
  // require switching to Graph's separate MIME-format `sendMail` input (raw base64 RFC 2045
  // body) — a materially different request shape, not built here.
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.fromAddress)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject: opts.subject,
          body: { contentType: opts.html ? "HTML" : "Text", content: opts.html ?? opts.text },
          toRecipients: [{ emailAddress: { address: opts.to } }],
        },
        saveToSentItems: false,
      }),
    },
  )

  if (!res.ok && res.status !== 202) {
    throw new Error(`Graph sendMail failed (${res.status}): ${await res.text()}`)
  }
}
