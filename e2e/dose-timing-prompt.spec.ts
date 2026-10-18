import { expect, test } from "@playwright/test"
import { loadSeed } from "./routes"

// A dose saved outside every slot window of a scheduled medication keeps the record screen open
// with a "Which dose was this?" banner; answering it takes the person on to the hub.

/**
 * A date in the instance zone (the seeded household is on Europe/London) well clear of the seeded dose,
 * which is a few hours old and so can sit on yesterday's 8:00 pm slot at some times of day.
 */
function threeDaysAgoInLondon(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() - 3 * 86_400_000))
}

test("a dose between two slots asks which dose it was, and Late takes you to the hub", async ({ page }) => {
  // Sam's Ibuprofen is scheduled for 8:00 am and 8:00 pm; 2:00 pm three days ago sits between them.
  const person = loadSeed().people[1]
  await page.goto(`/${person.id}/record-medication`)
  await page.getByLabel("Medication", { exact: true }).fill("Ibu")
  await page.getByRole("button", { name: /Ibuprofen/ }).click()
  await page.getByRole("switch", { name: "Record now" }).click()
  await page.getByLabel("Date", { exact: true }).fill(threeDaysAgoInLondon())
  await page.getByLabel("Time", { exact: true }).fill("14:00")
  await page.getByRole("button", { name: "Save" }).click()

  const prompt = page.getByRole("group", { name: "Which dose was this?" })
  await expect(prompt).toBeVisible()
  await expect(page).toHaveURL(`/${person.id}/record-medication`)
  await expect(prompt).toContainText("Not at a scheduled time:")
  await expect(prompt).toContainText("between the 8:00 am and 8:00 pm doses")
  await expect(prompt.getByRole("button", { name: "Late 8:00 am" })).toBeVisible()
  await expect(prompt.getByRole("button", { name: "Early 8:00 pm" })).toBeVisible()
  await expect(prompt.getByRole("button", { name: "Extra dose" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0)
  // The prompt takes focus, because the Save button it replaces has gone.
  await expect(prompt).toBeFocused()
  await expect(page.locator('[data-live-region="polite"]')).toContainText("Not at a scheduled time")

  await prompt.getByRole("button", { name: "Late 8:00 am" }).click()
  // The first answer can wait on the route compiling when the server runs in development mode.
  await expect(page).toHaveURL(`/${person.id}`, { timeout: 30_000 })
})
