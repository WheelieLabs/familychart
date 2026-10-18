import { readFileSync } from "node:fs"
import type { Seed } from "./global-setup"

export interface Route {
  /** Path with person ids filled in. */
  path: string
  /** Visited without a session. */
  signedOut?: boolean
}

export function loadSeed(): Seed {
  return JSON.parse(readFileSync("e2e/.auth/seed.json", "utf8")) as Seed
}

/**
 * Every page route in app/, once per page. Add a route here when a page is added. `/setup` is not
 * listed because it redirects away once setup is complete, which the seeded instance has done.
 */
export function routes(): Route[] {
  const person = loadSeed().people[0].id
  return [
    { path: "/login", signedOut: true },
    { path: "/accept-invite?token=invalid", signedOut: true },
    { path: "/reset-password?token=invalid", signedOut: true },
    { path: "/denied", signedOut: true },
    { path: "/account-removed", signedOut: true },
    { path: "/this-page-does-not-exist" },
    { path: "/" },
    { path: "/favourites" },
    { path: "/profile" },
    { path: `/${person}` },
    { path: `/${person}/history` },
    { path: `/${person}/history?tab=calendar` },
    { path: `/${person}/history?tab=summaries&summary=medication` },
    { path: `/${person}/history?tab=summaries&summary=observation` },
    { path: `/${person}/record-medication` },
    { path: `/${person}/record-observation` },
    { path: `/${person}/record-symptom` },
    { path: `/${person}/record-test-result` },
    { path: `/${person}/schedules-goals` },
    { path: `/${person}/schedules-goals?tab=observations` },
    { path: `/${person}/schedules-goals?tab=goals` },
    { path: `/${person}/test-chart` },
    { path: "/management" },
    { path: "/management/people" },
    { path: "/management/medications" },
    { path: "/management/observation-types" },
    { path: "/management/import" },
    { path: "/admin/overview" },
    { path: "/admin/accounts" },
    { path: "/admin/access-control" },
    { path: "/admin/audit-log" },
    { path: "/admin/entra-sessions" },
    { path: "/admin/export" },
    { path: `/admin/export/${loadSeed().inactivePerson.id}/erase` },
    { path: "/admin/files" },
    { path: "/admin/system-settings" },
    { path: "/diagnostics" },
    { path: "/diagnostics/app-lock" },
  ]
}
