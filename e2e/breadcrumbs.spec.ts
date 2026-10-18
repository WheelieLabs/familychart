import { expect, test, type Page } from "@playwright/test"
import { loadSeed } from "./routes"

// The trail goes up one level in the app's structure, never back in browser history.

const trail = (page: Page) => page.getByRole("navigation", { name: "Breadcrumb" })

test.describe("breadcrumbs", () => {
  test("a person's sub-pages go up to the person hub and end in the page", async ({ page }) => {
    const person = loadSeed().people[0]
    const pages: [string, string][] = [
      ["history", "History"],
      ["record-medication", "Record Medication"],
      ["record-observation", "Record Observation"],
      ["record-symptom", "Record Symptom"],
      ["record-test-result", "Record Test Result"],
      ["schedules-goals", "Schedules & Goals"],
      ["test-chart", "Test Result Chart"],
    ]
    for (const [sub, label] of pages) {
      await page.goto(`/${person.id}/${sub}`)
      await expect(trail(page).getByRole("link", { name: person.name }), sub).toHaveAttribute("href", `/${person.id}`)
      await expect(trail(page).locator('[aria-current="page"]'), sub).toHaveText(label)
    }
  })

  test("the person's header comes before the trail", async ({ page }) => {
    const person = loadSeed().people[0]
    await page.goto(`/${person.id}/history`)
    const header = await page.getByRole("img", { name: person.name }).or(page.getByText(person.name, { exact: true }).first()).boundingBox()
    const crumbs = await trail(page).boundingBox()
    expect(header!.y).toBeLessThan(crumbs!.y)
  })

  test("the person hub goes up to Home and is titled Select an Action", async ({ page }) => {
    const person = loadSeed().people[0]
    await page.goto(`/${person.id}`)
    await expect(trail(page).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/")
    await expect(trail(page).locator('[aria-current="page"]')).toHaveText(person.name)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Select an Action")
    await expect(page.getByRole("heading", { level: 2, name: person.name })).toBeVisible()
  })

  test("management and admin sub-pages go up to their hub", async ({ page }) => {
    for (const path of ["/management/people", "/management/medications", "/management/observation-types"]) {
      await page.goto(path)
      await expect(trail(page).getByRole("link", { name: "Management" }), path).toHaveAttribute("href", "/management")
    }
    for (const path of ["/admin/accounts", "/admin/access-control", "/admin/audit-log", "/admin/entra-sessions", "/admin/export", "/admin/files", "/admin/system-settings"]) {
      await page.goto(path)
      await expect(trail(page).getByRole("link", { name: "Administration" }), path).toHaveAttribute("href", "/admin/overview")
    }
    await page.goto("/admin/export")
    await expect(trail(page).locator('[aria-current="page"]')).toHaveText("Data Export & Restore")
    await page.goto(`/admin/export/${loadSeed().inactivePerson.id}/erase`)
    await expect(trail(page).getByRole("link", { name: "Data Export & Restore" })).toHaveAttribute("href", "/admin/export")
    await expect(trail(page).locator('[aria-current="page"]')).toHaveText("Erase Person")
    await page.goto("/diagnostics/app-lock")
    await expect(trail(page).getByRole("link", { name: "Diagnostics" })).toHaveAttribute("href", "/diagnostics")
  })

  test("Home, Profile, Favourites and the hubs have no trail", async ({ page }) => {
    for (const path of ["/", "/profile", "/favourites", "/management", "/admin/overview", "/diagnostics", "/account-removed"]) {
      await page.goto(path)
      await expect(trail(page), path).toHaveCount(0)
    }
  })

  test("the top-right chevron is gone", async ({ page }) => {
    await page.goto(`/${loadSeed().people[0].id}/history`)
    await expect(page.getByRole("link", { name: "Go back" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Go back" })).toHaveCount(0)
  })

  test("the trail goes to the parent even when the person arrived from elsewhere", async ({ page }) => {
    const person = loadSeed().people[0]
    await page.goto("/favourites")
    await page.goto(`/${person.id}/history`)
    await trail(page).getByRole("link", { name: person.name }).click()
    await expect(page).toHaveURL(`/${person.id}`)
  })
})
