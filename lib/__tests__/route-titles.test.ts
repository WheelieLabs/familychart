import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()

/** Each route's tab title; the root layout's template adds " · FamilyChart". */
const TITLES: Record<string, string> = {
  "app/[personId]/page.tsx": "Person",
  "app/[personId]/history": "History",
  "app/[personId]/record-medication": "Record Medication",
  "app/[personId]/record-observation": "Record Observation",
  "app/[personId]/record-symptom": "Record Symptom",
  "app/[personId]/record-test-result": "Record Test Result",
  "app/[personId]/schedules-goals/page.tsx": "Schedules & Goals",
  "app/[personId]/test-chart/page.tsx": "Test Result Chart",
  "app/favourites": "Favourites",
  "app/profile": "Profile",
  "app/(writable)/management/page.tsx": "Management",
  "app/(writable)/management/people": "People",
  "app/(writable)/management/medications": "Medications",
  "app/(writable)/management/observation-types": "Observation Types",
  "app/(writable)/management/import": "Import Records",
  "app/(writable)/admin/overview/page.tsx": "Administration",
  "app/(writable)/admin/accounts/page.tsx": "Accounts",
  "app/(writable)/admin/access-control": "Access Control",
  "app/(writable)/admin/audit-log": "Audit Log",
  "app/(writable)/admin/entra-sessions": "Entra Sessions",
  "app/(writable)/admin/export": "Data Export & Restore",
  "app/(writable)/admin/export/[id]/erase": "Erase Person",
  "app/(writable)/admin/files": "Files",
  "app/(writable)/admin/system-settings/page.tsx": "System Settings",
  "app/diagnostics/page.tsx": "Diagnostics",
  "app/diagnostics/app-lock": "App Lock",
  "app/denied/page.tsx": "Access Denied",
  "app/account-removed/page.tsx": "Account Removed",
  "app/login/page.tsx": "Sign In",
  "app/setup": "Setup",
  "app/accept-invite/page.tsx": "Accept Invite",
  "app/reset-password/page.tsx": "Reset Password",
  "app/not-found.tsx": "Page Not Found",
}

function source(entry: string): string {
  const file = entry.endsWith(".tsx") ? entry : join(entry, "layout.tsx")
  expect(existsSync(join(root, file)), `${file} exists`).toBe(true)
  return readFileSync(join(root, file), "utf8")
}

describe("route titles", () => {
  it("the root layout templates every title and keeps Home as FamilyChart", () => {
    const layout = readFileSync(join(root, "app/layout.tsx"), "utf8")
    expect(layout).toContain('default: "FamilyChart"')
    expect(layout).toContain('template: "%s · FamilyChart"')
  })

  it.each(Object.entries(TITLES))("%s is titled %s", (entry, title) => {
    expect(source(entry)).toMatch(new RegExp(`metadata: Metadata = \\{\\s*title: "${title.replace(/[&]/g, "\\$&")}"`))
  })
})
