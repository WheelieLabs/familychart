import { expect, test } from "@playwright/test"
import { loadSeed } from "./routes"

test.use({ viewport: { width: 390, height: 844 } })

test("the severity numbers sit under the points where the slider stops", async ({ page }) => {
  await page.goto(`/${loadSeed().people[0].id}/record-symptom`)
  const slider = page.getByRole("slider")
  await slider.focus()
  for (let i = 0; i < 3; i++) await slider.press("ArrowRight") // 1 to 4
  const track = (await slider.boundingBox())!
  const four = (await page.locator(".fc-slider__ticks span", { hasText: "4" }).boundingBox())!
  // The thumb is 24px wide: its centre travels from 12px in to 12px short of the far end.
  const thumbCentre = track.x + 12 + (track.width - 24) * 0.75
  expect(Math.abs(four.x + four.width / 2 - thumbCentre)).toBeLessThan(2)
})

test("Activity has no Show records button, because the list follows the dates; Summaries keeps its own", async ({ page }) => {
  const id = loadSeed().people[0].id
  await page.goto(`/${id}/history`)
  await expect(page.getByLabel("From")).toBeVisible()
  await expect(page.getByRole("button", { name: "Show records" })).toHaveCount(0)
  await page.goto(`/${id}/history?tab=summaries&summary=medication`)
  await page.getByRole("link", { name: "Paracetamol" }).click()
  await expect(page.getByRole("button", { name: "Show records" })).toBeVisible()
})

test("changing the Activity dates reloads the list", async ({ page }) => {
  const id = loadSeed().people[0].id
  await page.goto(`/${id}/history`)
  const request = page.waitForRequest(r => r.url().includes("/api/records?") && r.url().includes("from=2020-01-01"))
  await page.getByLabel("From").fill("2020-01-01")
  await request
})
