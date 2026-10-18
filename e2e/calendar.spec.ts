import { expect, test } from "@playwright/test"
import { loadSeed } from "./routes"

// The day sheet only appears once a day is chosen, and the grid uses the screen left under the controls.

for (const viewport of [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
]) {
  test.describe(`History calendar at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test("the day sheet is off screen until a day is chosen", async ({ page }) => {
      await page.goto(`/${loadSeed().people[0].id}/history?tab=calendar`)
      await expect(page.getByRole("heading", { level: 2, name: /\d{4}$/ })).toBeVisible()
      const sheetText = page.locator(".fc-sheet__body")
      await expect(sheetText).not.toBeInViewport()
      await page.getByRole("button", { name: /entr(y|ies)/ }).nth(10).click()
      await expect(sheetText).toBeInViewport()
      await page.locator(".fc-sheet").getByRole("button", { name: "Close" }).click()
      await expect(sheetText).not.toBeInViewport()
    })
  })
}

test.describe("History calendar on a tall phone", () => {
  test.use({ viewport: { width: 390, height: 1200 } })

  test("the grid fills the screen under the controls", async ({ page }) => {
    await page.goto(`/${loadSeed().people[0].id}/history?tab=calendar`)
    const cell = page.getByRole("button", { name: /entr(y|ies)/ }).nth(10)
    await expect(cell).toBeVisible()
    // The floor is 3.5rem (56px); with this much screen left the rows grow past it.
    expect((await cell.boundingBox())!.height).toBeGreaterThan(70)
  })
})
