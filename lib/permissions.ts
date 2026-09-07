// SPDX-License-Identifier: AGPL-3.0-only

import type { AppUser } from "./session"
import { sessionAccountUids } from "./account/account-identity"

export type Role = "readonly" | "readwrite" | "manager" | "admin"

const ROLE_HIERARCHY: Role[] = ["readonly", "readwrite", "manager", "admin"]

export function getUserRole(groups: string[]): Role | null {
  if (groups.includes("local:admin")) return "admin"
  if (groups.includes("local:manage")) return "manager"
  if (groups.includes("local:write")) return "readwrite"
  if (groups.includes("local:read")) return "readonly"

  const adminId     = process.env.ENTRA_GROUP_ADMIN
  const managerId   = process.env.ENTRA_GROUP_MANAGER
  const readwriteId = process.env.ENTRA_GROUP_READWRITE
  const readonlyId  = process.env.ENTRA_GROUP_READONLY

  if (adminId     && groups.includes(adminId))     return "admin"
  if (managerId   && groups.includes(managerId))   return "manager"
  if (readwriteId && groups.includes(readwriteId)) return "readwrite"
  if (readonlyId  && groups.includes(readonlyId))  return "readonly"
  return null
}

export function hasRole(groups: string[], minimumRole: Role): boolean {
  const role = getUserRole(groups)
  if (!role) return false
  return ROLE_HIERARCHY.indexOf(role) >= ROLE_HIERARCHY.indexOf(minimumRole)
}

export const isAdmin    = (groups: string[]) => hasRole(groups, "admin")
export const canManage  = (groups: string[]) => hasRole(groups, "manager")
export const canWrite   = (groups: string[]) => hasRole(groups, "readwrite")
export const canRead    = (groups: string[]) => hasRole(groups, "readonly")
export const canReport  = (groups: string[]) => {
  if (groups.includes("local:report") || groups.includes("local:admin")) return true
  const reportsId = process.env.ENTRA_GROUP_REPORTS
  return !!(reportsId && groups.includes(reportsId))
}

export function canWriteForPerson(
  groups: string[],
  sessionUser: AppUser | null | undefined,
  personUid: string | null | undefined
): boolean {
  if (canWrite(groups)) return true
  if (!personUid) return false
  return sessionAccountUids(sessionUser).includes(personUid)
}

export function canReadForPerson(
  groups: string[],
  sessionUser: AppUser | null | undefined,
  personUid: string | null | undefined
): boolean {
  if (canRead(groups)) return true
  if (!personUid) return false
  return sessionAccountUids(sessionUser).includes(personUid)
}

/**
 * True when the session may use read-scoped app surfaces: global `canRead`, or at least
 * one active person linked via `people.account_uid` (see ADR-0009).
 */
export function hasAnyReadablePerson(
  peopleUserUids: Array<string | null | undefined>,
  groups: string[],
  sessionUser: AppUser | null | undefined,
): boolean {
  if (canRead(groups)) return true
  return peopleUserUids.some(uid => canReadForPerson(groups, sessionUser, uid))
}
