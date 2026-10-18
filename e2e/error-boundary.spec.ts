import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"
import { loadSeed } from "./routes"

// A render error shows the branded boundary, with a way back, instead of the framework's default page.

test.describe("error boundary", () => {
  test.beforeEach(async ({ page }) => {
    const id = loadSeed().people[0].id
    // A person whose name is not text makes the page throw while rendering.
    await page.route(`**/api/people/${id}`, route =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ id, name: { not: "text" }, color: "#000000" }) }),
    )
    await page.goto(`/${id}/history`)
  })

  test("a thrown render error shows the boundary with a way back", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1, name: "Error" })).toBeVisible()
    await expect(page.getByRole("heading", { level: 2, name: "Something went wrong" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Go Home" })).toHaveAttribute("href", "/")
    await expect(page).toHaveTitle("Error · FamilyChart")
    await expect(page.getByRole("main")).toHaveCount(1)
  })

  test("Go Home leaves the error", async ({ page }) => {
    await page.unroute("**/api/people/**")
    await page.getByRole("link", { name: "Go Home" }).click()
    await expect(page).toHaveURL("/")
    await expect(page.getByText("Something went wrong")).toHaveCount(0)
  })

  test("the boundary passes the accessibility scan", async ({ page }) => {
    await expect(page.getByText("Something went wrong")).toBeVisible()
    await page.waitForLoadState("networkidle")
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze()
    expect(results.violations.map(v => v.id)).toEqual([])
  })
})
