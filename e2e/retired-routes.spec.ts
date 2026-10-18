import { expect, test } from "@playwright/test"
import { ADMIN } from "./global-setup"

// These URLs used to redirect. A signed-in request now gets the app's 404.

const RETIRED = [
  "/admin/people",
  "/admin/import",
  "/admin/medications",
  "/admin/medication-groups",
  "/admin/local-users",
  "/management/schedules-goals",
  "/management/schedules-goals?tab=medications",
  "/management/schedules-goals?tab=observations",
  "/api/local-users",
  "/api/local-users/1",
]

test.describe("retired URLs", () => {
  for (const path of RETIRED) {
    test(`${path} is not found`, async ({ page }) => {
      const response = await page.goto(path)
      expect(response?.status(), path).toBe(404)
    })
  }

  test("a retired admin page shows Page not found", async ({ page }) => {
    await page.goto("/admin/people")
    await expect(page.getByRole("heading", { level: 2, name: "Page not found" })).toBeVisible()
  })
})

test.describe("Accounts", () => {
  test("still invites from Administration and lists the signed-in admin", async ({ page }) => {
    await page.goto("/admin/accounts")
    await expect(page.getByRole("heading", { level: 1, name: "Accounts" })).toBeVisible()
    await expect(page.getByRole("button", { name: /Send invite/ })).toBeVisible()
    await expect(page.getByText(ADMIN.email)).toBeVisible()
  })
})
