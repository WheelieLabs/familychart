// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Read-only Entra group membership listing for the Access Control admin card.
 * Uses the same app-only Graph credentials as auth revalidation (ADR-0009).
 */

import { getAppOnlyGraphToken, loadEntraGraphConfig } from "@/lib/entra-graph-token"

export type EntraRoleLabel = "Admin" | "Manager" | "ReadWrite" | "ReadOnly" | "Reports"

export interface ConfiguredEntraGroup {
  role: EntraRoleLabel
  envVar: string
  groupId: string
}

export interface EntraGroupMember {
  id: string
  displayName: string | null
  email: string | null
  type: "user" | "group" | "other"
}

export interface EntraGroupMembership {
  role: EntraRoleLabel
  envVar: string
  groupId: string
  groupDisplayName: string | null
  members: EntraGroupMember[]
  error?: string
}

const ROLE_ENV: { role: EntraRoleLabel; envVar: string }[] = [
  { role: "Admin", envVar: "ENTRA_GROUP_ADMIN" },
  { role: "Manager", envVar: "ENTRA_GROUP_MANAGER" },
  { role: "ReadWrite", envVar: "ENTRA_GROUP_READWRITE" },
  { role: "ReadOnly", envVar: "ENTRA_GROUP_READONLY" },
  { role: "Reports", envVar: "ENTRA_GROUP_REPORTS" },
]

export function listConfiguredEntraGroups(
  env: Record<string, string | undefined> = process.env,
): ConfiguredEntraGroup[] {
  const out: ConfiguredEntraGroup[] = []
  for (const { role, envVar } of ROLE_ENV) {
    const groupId = env[envVar]?.trim()
    if (groupId) out.push({ role, envVar, groupId })
  }
  return out
}

function memberType(odataType: string | undefined): EntraGroupMember["type"] {
  if (odataType === "#microsoft.graph.user") return "user"
  if (odataType === "#microsoft.graph.group") return "group"
  return "other"
}

async function fetchGroupDisplayName(
  token: string,
  groupId: string,
): Promise<string | null> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(groupId)}?$select=id,displayName`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`Graph group lookup failed (${res.status})`)
  }
  const data = (await res.json()) as { displayName?: string }
  return data.displayName?.trim() || null
}

async function fetchAllMembers(token: string, groupId: string): Promise<EntraGroupMember[]> {
  const members: EntraGroupMember[] = []
  let url: string | null =
    `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(groupId)}/members` +
    `?$select=id,displayName,mail,userPrincipalName&$top=100`

  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (res.status === 404) {
      throw new Error("Group not found")
    }
    if (!res.ok) {
      throw new Error(`Graph members lookup failed (${res.status})`)
    }
    const data = (await res.json()) as {
      value?: {
        id: string
        displayName?: string
        mail?: string
        userPrincipalName?: string
        "@odata.type"?: string
      }[]
      "@odata.nextLink"?: string
    }
    for (const m of data.value ?? []) {
      const email = m.mail?.trim() || m.userPrincipalName?.trim() || null
      members.push({
        id: m.id,
        displayName: m.displayName?.trim() || null,
        email,
        type: memberType(m["@odata.type"]),
      })
    }
    url = data["@odata.nextLink"] ?? null
  }

  members.sort((a, b) => {
    const an = (a.displayName || a.email || a.id).toLowerCase()
    const bn = (b.displayName || b.email || b.id).toLowerCase()
    return an.localeCompare(bn)
  })
  return members
}

export type AccessControlStatus =
  | "ok"
  | "no_groups_configured"
  | "graph_not_configured"
  | "error"

export interface AccessControlResult {
  status: AccessControlStatus
  groups: EntraGroupMembership[]
  message?: string
}

/**
 * Lists members of each configured `ENTRA_GROUP_*` via Microsoft Graph (read-only).
 * Requires app-only `GroupMember.Read.All` (same grant as auth revalidation).
 */
export async function loadAccessControlMemberships(
  env: Record<string, string | undefined> = process.env,
): Promise<AccessControlResult> {
  const configured = listConfiguredEntraGroups(env)
  if (configured.length === 0) {
    return {
      status: "no_groups_configured",
      groups: [],
      message:
        "No ENTRA_GROUP_* environment variables are set. Role access is configured via Entra security group Object IDs or local accounts.",
    }
  }

  const cfg = loadEntraGraphConfig()
  if (!cfg) {
    return {
      status: "graph_not_configured",
      groups: configured.map(g => ({
        role: g.role,
        envVar: g.envVar,
        groupId: g.groupId,
        groupDisplayName: null,
        members: [],
      })),
      message:
        "Entra groups are configured, but app-only Graph credentials are not available in the environment. Set AUTH_MICROSOFT_ENTRA_ID_ID, AUTH_MICROSOFT_ENTRA_ID_TENANT_ID, and AUTH_MICROSOFT_ENTRA_ID_SECRET with GroupMember.Read.All granted to list members.",
    }
  }

  try {
    const token = await getAppOnlyGraphToken(cfg)
    const groups: EntraGroupMembership[] = []
    for (const g of configured) {
      try {
        const [groupDisplayName, members] = await Promise.all([
          fetchGroupDisplayName(token, g.groupId),
          fetchAllMembers(token, g.groupId),
        ])
        groups.push({
          role: g.role,
          envVar: g.envVar,
          groupId: g.groupId,
          groupDisplayName,
          members,
        })
      } catch (err) {
        groups.push({
          role: g.role,
          envVar: g.envVar,
          groupId: g.groupId,
          groupDisplayName: null,
          members: [],
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    return { status: "ok", groups }
  } catch (err) {
    return {
      status: "error",
      groups: [],
      message: err instanceof Error ? err.message : String(err),
    }
  }
}
