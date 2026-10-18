import { expect, test } from "@playwright/test"
import { loadSeed } from "./routes"

// Saving shows a one-time confirmation on the person hub, a failed save announces the problem and
// focuses the field, and the closed Quick record sheet cannot be reached.

test.describe("save flash", () => {
  test("a saved symptom shows a dismissible banner on the hub, once, and announces it", async ({ page }) => {
    const person = loadSeed().people[0]
    await page.goto(`/${person.id}/record-symptom`)
    await page.getByRole("combobox", { name: "Symptom" }).fill("Cough")
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page).toHaveURL(`/${person.id}`)

    await expect(page.locator(".fc-banner")).toContainText("Saved: Cough")
    await expect(page.locator('[data-live-region="polite"]')).toContainText("Saved: Cough")

    await page.reload()
    await expect(page.locator(".fc-banner")).toHaveCount(0)
  })

  test("the banner can be dismissed", async ({ page }) => {
    const person = loadSeed().people[0]
    await page.goto(`/${person.id}/record-symptom`)
    await page.getByRole("combobox", { name: "Symptom" }).fill("Sneezing")
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.locator(".fc-banner")).toBeVisible()
    await page.getByRole("button", { name: "Dismiss" }).click()
    await expect(page.locator(".fc-banner")).toHaveCount(0)
  })
})

test.describe("record forms save", () => {
  test("a medication picked from the suggestions saves and shows on the hub", async ({ page }) => {
    const person = loadSeed().people[1]
    await page.goto(`/${person.id}/record-medication`)
    await page.getByLabel("Medication", { exact: true }).fill("Ibu")
    await page.getByRole("button", { name: /Ibuprofen/ }).click()
    await expect(page.getByLabel(/^Dosage/)).toHaveValue("200")
    await page.getByRole("button", { name: "Save" }).click()
    // Sam's Ibuprofen is scheduled, so a dose outside a slot window asks which dose it was first.
    const extra = page.getByRole("button", { name: "Extra dose" })
    await expect.poll(async () => (await extra.isVisible()) || page.url().endsWith(`/${person.id}`)).toBe(true)
    if (await extra.isVisible()) await extra.click()
    await expect(page).toHaveURL(`/${person.id}`)
    await expect(page.locator(".fc-banner")).toContainText("Saved: Ibuprofen")
  })

  test("an observation saves and shows on the hub", async ({ page }) => {
    const person = loadSeed().people[1]
    await page.goto(`/${person.id}/record-observation`)
    await page.getByRole("combobox", { name: "Observation type" }).selectOption("Weight")
    await page.getByLabel("Value", { exact: true }).fill("19.5")
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page).toHaveURL(`/${person.id}`)
    await expect(page.locator(".fc-banner")).toContainText("Saved: Weight 19.5")
  })

  test("a missing observation value focuses the field and says what to do", async ({ page }) => {
    await page.goto(`/${loadSeed().people[1].id}/record-observation`)
    await page.getByRole("combobox", { name: "Observation type" }).selectOption("Weight")
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.getByLabel("Value", { exact: true })).toBeFocused()
    await expect(page.getByText("Enter a value.")).toBeVisible()
  })
})

test.describe("invalid save", () => {
  test("announces the problem and focuses the first invalid field", async ({ page }) => {
    await page.goto(`/${loadSeed().people[0].id}/record-symptom`)
    await page.getByRole("button", { name: "Save" }).click()
    const field = page.getByRole("combobox", { name: "Symptom" })
    await expect(field).toBeFocused()
    await expect(field).toHaveAttribute("aria-invalid", "true")
    await expect(page.locator('[data-live-region="assertive"]')).toContainText("1 problem to fix. First: Symptom.")
  })
})

test.describe("Quick record sheet", () => {
  test("is not reachable or exposed while closed", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    const sheet = page.locator('[role="dialog"][aria-label="Quick record"]')
    await expect(sheet).toHaveAttribute("inert", "")
    // The browser's own accessibility tree leaves an inert subtree out.
    const cdp = await page.context().newCDPSession(page)
    const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as {
      nodes: { ignored?: boolean; role?: { value?: string }; name?: { value?: string } }[]
    }
    const exposed = nodes.filter(n => !n.ignored && n.role?.value === "dialog" && n.name?.value === "Quick record")
    expect(exposed).toHaveLength(0)
    // And Tab never lands inside it.
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab")
      expect(await sheet.evaluate(el => el.contains(document.activeElement))).toBe(false)
    }
  })

  test("opens with focus inside, closes on Escape and returns focus to the star", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    const star = page.getByRole("button", { name: "Quick record" })
    await star.click()
    const dialog = page.getByRole("dialog", { name: "Quick record" })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(page.locator('[role="dialog"][aria-label="Quick record"]')).toHaveAttribute("inert", "")
    await expect(star).toBeFocused()
  })

  test("keeps Tab inside while open", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.getByRole("button", { name: "Quick record" }).click()
    const dialog = page.getByRole("dialog", { name: "Quick record" })
    await expect(dialog).toBeVisible()
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab")
      expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
    }
  })
})
