// SPDX-License-Identifier: AGPL-3.0-only

import { NONE_ROLE } from "@/lib/account/none-role"

/** Household Role options for local Accounts. None is absence of a rung, listed last. */
export const HOUSEHOLD_ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "manage", label: "Manager" },
  { value: "write", label: "Read/Write" },
  { value: "read", label: "Read Only" },
  { value: NONE_ROLE, label: "None" },
] as const

const ROLE_LABELS: Record<string, string> = Object.fromEntries(
  HOUSEHOLD_ROLE_OPTIONS.map(role => [role.value, role.label]),
)

export function householdRoleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role
}

/** Accounts-list copy for the Household Reports flag. Self-report is not this flag. */
export function householdReportsListCopy(canReport: number): string {
  return canReport ? "Can access reports" : "Cannot access reports"
}

/** Role and Household Reports text shown on one Accounts-list row. */
export function accountListCopy(account: {
  auth_method: string
  role: string
  can_report: number
}): { role: string; reports: string } {
  return {
    role: account.auth_method === "entra"
      ? "Role from Entra"
      : `Role: ${householdRoleLabel(account.role)}`,
    reports: householdReportsListCopy(account.can_report),
  }
}
