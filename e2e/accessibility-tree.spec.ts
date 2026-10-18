import { expect, test } from "@playwright/test"
import { loadSeed } from "./routes"

// Accessibility-tree assertions: roles, names and states as a screen reader is given them, checked
// from logic instead of by hand. Each assertion here passes today; later slices extend the set as
// their screens gain landmarks, labels and live regions.

test.describe("landmarks", () => {
  test("the home page has a banner, a main landmark and a footer", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByRole("banner")).toHaveCount(1)
    await expect(page.getByRole("main")).toHaveCount(1)
    await expect(page.getByRole("contentinfo")).toHaveCount(1)
  })

  test("a person page has exactly one main landmark and one level-one heading", async ({ page }) => {
    await page.goto(`/${loadSeed().people[0].id}`)
    await expect(page.getByRole("main")).toHaveCount(1)
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1)
  })

  test("the page offers a skip link to the main content", async ({ page }) => {
    await page.goto("/")
    const skip = page.getByRole("link", { name: /skip to (main )?content/i })
    await expect(skip).toHaveAttribute("href", "#main-content")
    await expect(page.locator("#main-content")).toHaveCount(1)
  })
})

test.describe("page titles follow the naming table", () => {
  const titles: [string, string][] = [
    ["/account-removed", "Account Removed"],
    ["/admin/overview", "Administration"],
    ["/admin/accounts", "Accounts"],
    ["/admin/access-control", "Access Control"],
    ["/admin/audit-log", "Audit Log"],
    ["/admin/entra-sessions", "Entra Sessions"],
    ["/admin/export", "Data Export & Restore"],
    [`/admin/export/${loadSeed().inactivePerson.id}/erase`, "Erase Person"],
    ["/admin/files", "Files"],
    ["/admin/system-settings", "System Settings"],
    ["/diagnostics", "Diagnostics"],
    ["/diagnostics/app-lock", "App Lock"],
  ]
  for (const [path, title] of titles) {
    test(`${path} is titled ${title}`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title)
      await expect(page.getByRole("main")).toHaveCount(1)
    })
  }
})

test.describe("Import Records", () => {
  test("has one main landmark and the skip link reaches it", async ({ page }) => {
    await page.goto("/management/import")
    await expect(page.getByRole("main")).toHaveCount(1)
    await expect(page.getByRole("link", { name: /skip to (main )?content/i })).toHaveAttribute("href", "#main-content")
    await expect(page.locator("#main-content")).toHaveCount(1)
  })
})

test.describe("sign in", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("the form fields are named", async ({ page }) => {
    await page.goto("/login")
    await expect(page.getByRole("textbox", { name: "Email address" })).toBeVisible()
    await expect(page.getByRole("textbox", { name: "Password" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible()
  })
})

test.describe("keyboard", () => {
  test("the first Tab stop on a page is the skip link", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.keyboard.press("Tab")
    await expect(page.getByRole("link", { name: /skip to (main )?content/i })).toBeFocused()
  })
})

test.describe("record forms", () => {
  test("Record Medication names the date, time, medication, dosage and unit", async ({ page }) => {
    await page.goto(`/${loadSeed().people[0].id}/record-medication`)
    await expect(page.getByRole("switch", { name: "Record now" })).toBeVisible()
    await expect(page.getByLabel("Date", { exact: true })).toBeVisible()
    await expect(page.getByLabel("Time", { exact: true })).toBeVisible()
    await expect(page.getByLabel("Medication", { exact: true })).toBeVisible()
    await expect(page.getByLabel(/^Dosage/)).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Unit" })).toBeVisible()
    await expect(page.getByRole("radiogroup", { name: "Administered by" })).toBeVisible()
  })

  test("Record Observation names the type, value and unit", async ({ page }) => {
    await page.goto(`/${loadSeed().people[0].id}/record-observation`)
    await expect(page.getByRole("combobox", { name: "Observation type" })).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Unit" })).toBeVisible()
    await expect(page.getByRole("switch", { name: "Record now" })).toBeVisible()
  })

  test("Record Symptom starts severity at 1 of 5 and names every control", async ({ page }) => {
    await page.goto(`/${loadSeed().people[0].id}/record-symptom`)
    await expect(page.getByRole("combobox", { name: "Symptom" })).toBeVisible()
    await expect(page.getByLabel("Start date")).toBeVisible()
    await expect(page.getByRole("slider", { name: "Severity" })).toHaveAttribute("aria-valuetext", "1 of 5")
    await expect(page.getByRole("checkbox", { name: "Has an end date" })).toBeVisible()
    await expect(page.getByRole("checkbox", { name: "Mark as resolved" })).toBeVisible()
  })

  test("every visible control on a Record form has an accessible name", async ({ page }) => {
    const person = loadSeed().people[0].id
    for (const path of ["record-medication", "record-observation", "record-symptom", "record-test-result"]) {
      await page.goto(`/${person}/${path}`)
      await page.waitForLoadState("networkidle")
      const unnamed = await page.evaluate(() => {
        const controls = Array.from(document.querySelectorAll<HTMLElement>("main input, main select, main textarea, main button"))
        return controls
          .filter(el => el.getClientRects().length > 0 && !(el as HTMLInputElement).hidden)
          .filter(el => {
            const labelled = (el as HTMLInputElement).labels?.length
            const text = (el.textContent ?? "").trim()
            return !labelled && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby") && !text
          })
          .map(el => el.outerHTML.slice(0, 80))
      })
      expect(unnamed, `${path}: controls without an accessible name`).toEqual([])
    }
  })

  test("a form field spells the chosen date out", async ({ page }) => {
    await page.goto(`/${loadSeed().people[0].id}/record-symptom`)
    await page.getByLabel("Start date").fill("2026-10-09")
    await expect(page.getByText("Friday 9 October 2026")).toBeVisible()
  })
})

test.describe("person hub and History", () => {
  test("the person hub is titled Select an Action, names the person in the page and has the status tabs", async ({ page }) => {
    const person = loadSeed().people[0]
    await page.goto(`/${person.id}`)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Select an Action")
    await expect(page.getByRole("heading", { level: 2, name: person.name })).toBeVisible()
    await expect(page.getByRole("tablist", { name: "Status view" })).toBeVisible()
    await expect(page.getByRole("link", { name: "History" })).toBeVisible()
  })

  test("a Summaries row link has the visible title as its name", async ({ page }) => {
    await page.goto(`/${loadSeed().people[0].id}/history?tab=summaries&summary=medication`)
    await expect(page.getByRole("link", { name: "Paracetamol" })).toBeVisible()
  })

  test("the Calendar names every day and opens a day's entries", async ({ page }) => {
    await page.goto(`/${loadSeed().people[0].id}/history?tab=calendar`)
    const days = page.getByRole("button", { name: /\d+ entr(y|ies)/ })
    await expect(days.first()).toBeVisible()
    await days.first().click()
    await expect(page.locator("#main-content").getByRole("button", { name: "Close" })).toBeVisible()
  })

  test("the Activity range fields are labelled", async ({ page }) => {
    await page.goto(`/${loadSeed().people[0].id}/history`)
    await expect(page.getByLabel("From")).toBeVisible()
    await expect(page.getByLabel("To", { exact: true })).toBeVisible()
    await expect(page.getByRole("radiogroup", { name: "Show" })).toBeVisible()
  })
})
