import AxeBuilder from "@axe-core/playwright"
import { expect, test, type APIRequestContext, type Page } from "@playwright/test"
import { TAGS, VIEWPORTS } from "./axe-config"

// The warning that Entra access is not being rechecked. Entra sign-in is switched on through System
// Settings with its credentials held there (not in env), which is exactly the "Graph not configured"
// case. It is switched off again afterwards. This file runs in its own project, after every other
// test, because the setting changes the sign-in page and the Administration overview.
test.describe.configure({ mode: "serial" })

const BANNER = ".fc-banner--warning"
const ENTRA_SETTINGS = {
  "auth.entra.client_id": "ui-test-client",
  "auth.entra.tenant_id": "ui-test-tenant",
  "auth.entra.client_secret": "ui-test-secret",
  "auth.entra.enabled": "true",
}

async function patchSetting(api: APIRequestContext, key: string, value: string) {
  const res = await api.patch("/api/app-settings", { data: { key, value } })
  expect(res.ok(), `PATCH ${key}: ${res.status()} ${await res.text()}`).toBe(true)
}

async function expectNoAxeViolations(page: Page, path: string) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto(path)
    await page.waitForLoadState("networkidle")
    await expect(page.locator(BANNER)).toBeVisible()
    const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
    expect(
      violations.map(v => `${v.id} at ${viewport.name}: ${v.help}`),
      `${path} with the warning banner`,
    ).toEqual([])
  }
}

test.describe("Entra sign-in off", () => {
  for (const path of ["/admin/overview", "/admin/entra-sessions"]) {
    test(`${path} shows no warning`, async ({ page }) => {
      await page.goto(path)
      await page.waitForLoadState("networkidle")
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
      await expect(page.getByText("isn't being rechecked", { exact: false })).toHaveCount(0)
      await expect(page.getByText("no group data", { exact: false })).toHaveCount(0)
    })
  }
})

test.describe("Entra sign-in on, Graph not configured", () => {
  let api: APIRequestContext

  test.beforeAll(async ({ playwright, baseURL }) => {
    api = await playwright.request.newContext({ baseURL, storageState: "e2e/.auth/admin.json" })
    for (const [key, value] of Object.entries(ENTRA_SETTINGS)) await patchSetting(api, key, value)
  })

  test.afterAll(async () => {
    await patchSetting(api, "auth.entra.enabled", "false")
    await api.dispose()
  })

  test("the Administration overview shows the short warning and is axe-clean", async ({ page }) => {
    await page.goto("/admin/overview")
    const banner = page.locator(BANNER)
    await expect(banner).toContainText("Entra access isn't being rechecked")
    await expect(banner.getByRole("link", { name: "Entra Sessions" })).toHaveAttribute("href", "/admin/entra-sessions")
    await expectNoAxeViolations(page, "/admin/overview")
  })

  test("Entra Sessions shows the full warning and is axe-clean", async ({ page }) => {
    await page.goto("/admin/entra-sessions")
    const banner = page.locator(BANNER)
    await expect(banner).toContainText("Microsoft Graph isn't configured")
    await expect(banner).toContainText("User.Read.All")
    // The test instance has no outbound email, so the warning says email alerts are off.
    await expect(banner).toContainText("Email alerts are off because outbound email is not configured.")
    await expectNoAxeViolations(page, "/admin/entra-sessions")
  })

  test("Entra Sessions with users stuck without group data shows the count and is axe-clean", async ({ page }) => {
    // The count needs Graph configured through env on the server, so the page's data is stubbed here;
    // the banner, the page and axe are the real ones.
    await page.route("**/api/admin/entra-sessions", route =>
      route.fulfill({
        json: {
          sessions: ["a", "b", "c"].map(n => ({
            provider: "entra",
            externalId: `oid-${n}`,
            status: "ok",
            lastCheckedAt: null,
            groups: null,
            email: `${n}@example.com`,
            displayName: `User ${n}`,
            updatedAt: 0,
          })),
          revalidationGap: { graphConfigured: true, usersWithoutGroupData: 3 },
          outboundEmailConfigured: true,
        },
      }),
    )
    await page.goto("/admin/entra-sessions")
    await expect(page.locator(BANNER)).toContainText("3 Entra users have no group data")
    await expect(page.locator(BANNER)).not.toContainText("Email alerts are off")
    await expectNoAxeViolations(page, "/admin/entra-sessions")
  })
})
