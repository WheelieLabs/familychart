import { expect, test } from "@playwright/test"
import { loadSeed } from "./routes"

// Layout and landmark checks for the app chrome (header, footer, live regions) at phone and
// desktop widths.

const WIDTHS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
]

for (const viewport of WIDTHS) {
  test.describe(`chrome at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test("the header is a fixed 72px and the title never overlaps a control", async ({ page }) => {
      await page.goto(`/${loadSeed().people[0].id}/history`)
      // The header gains its controls once /api/me answers, which moves the title.
      await page.waitForLoadState("networkidle")
      await expect(page.getByRole("button", { name: "Menu" })).toBeVisible()
      const header = page.getByRole("banner")
      const box = (await header.boundingBox())!
      expect(box.height).toBe(72)

      const title = (await page.getByRole("heading", { level: 1 }).boundingBox())!
      const controls = await header.getByRole("button").all()
      for (const control of controls) {
        const c = (await control.boundingBox())!
        const overlaps = title.x < c.x + c.width && c.x < title.x + title.width
        expect(overlaps, "title overlaps a header control").toBe(false)
      }
    })

    test("the page does not scroll sideways", async ({ page }) => {
      await page.goto("/")
      await page.waitForLoadState("networkidle")
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)
    })
  })
}

test.describe("chrome on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("the footer is compact: two lines, about 56px", async ({ page }) => {
    await page.goto("/")
    const box = (await page.getByRole("contentinfo").boundingBox())!
    expect(box.height).toBeLessThanOrEqual(64)
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Licences" })).toBeVisible()
  })
})

test.describe("app-wide", () => {
  test("the page language is Australian English", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("html")).toHaveAttribute("lang", "en-AU")
  })

  test("there is one polite live region and one assertive one", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator('[data-live-region="polite"]')).toHaveAttribute("role", "status")
    await expect(page.locator('[data-live-region="assertive"]')).toHaveAttribute("role", "alert")
    await expect(page.locator("[data-live-region]")).toHaveCount(2)
  })

  test("the footer links are named", async ({ page }) => {
    await page.goto("/")
    const footer = page.getByRole("contentinfo")
    await expect(footer.getByRole("link", { name: "Source" })).toBeVisible()
    await expect(footer.getByRole("link", { name: "Licences" })).toBeVisible()
  })
})
