import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"
import { TAGS, VIEWPORTS } from "./axe-config"
import { routes } from "./routes"

// Known violations, by route and axe rule. The list only shrinks: fixing a screen removes its
// entries, and an entry that no longer fires fails the test until it is removed. Never add one by
// hand to get a change through. `FC_UI_WRITE_ALLOWLIST=1 npx playwright test axe --workers=1`
// prunes the file to the violations that still fire (it can only remove entries). Each test writes
// what it found to test-results/axe-found, and e2e/global-teardown.ts merges them, so pruning runs in
// parallel like any other run.
const ALLOWLIST_FILE = "e2e/axe-allowlist.json"
const WRITE = !!process.env.FC_UI_WRITE_ALLOWLIST
const FOUND_DIR = "test-results/axe-found"

const allowlist: Record<string, string[]> = JSON.parse(readFileSync(ALLOWLIST_FILE, "utf8"))

for (const route of routes()) {
  const key = route.path.split("?")[0].replace(/^\/\d+/, "/[personId]")

  test.describe(`axe ${route.path}`, () => {
    if (route.signedOut) test.use({ storageState: { cookies: [], origins: [] } })

    test(`has no new accessibility violations`, async ({ page }) => {
      const found = new Map<string, string>()

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await page.goto(route.path)
        await page.waitForLoadState("networkidle")
        const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
        for (const v of violations) {
          const first = v.nodes[0]?.target.join(" ") ?? ""
          found.set(v.id, `${v.id} (${v.nodes.length} at ${viewport.name}, e.g. ${first}): ${v.help}`)
        }
      }

      if (WRITE) {
        mkdirSync(FOUND_DIR, { recursive: true })
        writeFileSync(`${FOUND_DIR}/${encodeURIComponent(key)}.json`, JSON.stringify([...found.keys()]))
        return
      }

      const allowed = new Set(allowlist[key] ?? [])
      const unexpected = [...found].filter(([id]) => !allowed.has(id)).map(([, text]) => text)
      expect(unexpected, "new violations: fix them, do not allowlist them").toEqual([])

      const stale = [...allowed].filter(id => !found.has(id))
      expect(stale, `allowlist entries that no longer fire for ${key}: remove them from ${ALLOWLIST_FILE}`).toEqual([])
    })
  })
}
