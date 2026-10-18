import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { describe, expect, it } from "vitest"
import nextConfig from "../../next.config"

/** Paths this removal retires. The 404 spec and this file are the only places allowed to name them. */
const RETIRED_URLS = [
  "/api/local-users",
  "/admin/local-users",
  "/admin/people",
  "/admin/import",
  "/admin/medications",
  "/admin/medication-groups",
]

describe("retired redirects", () => {
  it("does not redirect legacy admin or management URLs", () => {
    expect(nextConfig.redirects).toBeUndefined()
  })

  it("no longer has the local-users pages or API handler", () => {
    expect(existsSync("app/(writable)/admin/local-users/page.tsx")).toBe(false)
    expect(existsSync("app/(writable)/admin/local-users/layout.tsx")).toBe(false)
    expect(existsSync("app/api/local-users/route.ts")).toBe(false)
    expect(existsSync("app/api/local-users/[id]/route.ts")).toBe(false)
  })

  it("no route, page, doc or other test still names the retired URLs", () => {
    let hits = ""
    try {
      hits = execFileSync(
        "git",
        ["grep", "-n", "-F", ...RETIRED_URLS.flatMap(url => ["-e", url]), "--", ".",
          ":!lib/__tests__/retired-redirects.test.ts",
          ":!e2e/retired-routes.spec.ts"],
        { encoding: "utf8" },
      )
    } catch (err) {
      const failed = err as { status?: number; stdout?: string }
      if (failed.status !== 1) throw err
      hits = failed.stdout ?? ""
    }
    expect(hits).toBe("")
  })
})
