import { expect, test } from "@playwright/test"

// The sign-in screens: visible labels, Show password, a plain failed-sign-in error and the dead ends.

test.describe("sign in", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("every field has a visible label and the optional code is marked", async ({ page }) => {
    await page.goto("/login")
    await expect(page.getByLabel("Email address")).toBeVisible()
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible()
    await expect(page.getByLabel(/^Authenticator code/)).toBeVisible()
    await expect(page.getByText("(optional)")).toBeVisible()
    await expect(page.getByText("Only if your account uses an authenticator app.")).toBeVisible()
  })

  test("Show password switches the field type without blocking paste", async ({ page }) => {
    await page.goto("/login")
    const password = page.getByLabel("Password", { exact: true })
    await expect(password).toHaveAttribute("type", "password")
    await page.getByRole("checkbox", { name: "Show password" }).check()
    await expect(password).toHaveAttribute("type", "text")
    await page.getByRole("checkbox", { name: "Show password" }).uncheck()
    await expect(password).toHaveAttribute("type", "password")
    await expect(password).not.toHaveAttribute("onpaste", /.*/)
  })

  test("a failed sign-in shows one plain message and returns focus to the email field", async ({ page }) => {
    await page.goto("/login")
    await page.getByLabel("Email address").fill("nobody@example.com")
    await page.getByLabel("Password", { exact: true }).fill("not-the-right-password")
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page.locator('.fc-banner[role="alert"]')).toContainText("Email or password is incorrect.")
    await expect(page.getByLabel("Email address")).toBeFocused()
  })

  test("an invite link without a token is a dead end with a way back", async ({ page }) => {
    await page.goto("/accept-invite")
    await expect(page.getByRole("heading", { name: "This invite link isn't valid" })).toBeVisible()
    await page.getByRole("link", { name: "Back to sign in" }).click()
    await expect(page).toHaveURL(/\/login/)
  })

  test("a reset link without a token says reset link", async ({ page }) => {
    await page.goto("/reset-password")
    await expect(page.getByRole("heading", { name: "This reset link isn't valid" })).toBeVisible()
  })

  test("Access denied offers Go Home", async ({ page }) => {
    await page.goto("/denied")
    await expect(page.getByRole("heading", { level: 2, name: "Access denied" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Go Home" })).toBeVisible()
  })
})

test.describe("dead ends when signed in", () => {
  test("Page not found has a heading, copy and Go Home", async ({ page }) => {
    await page.goto("/this-page-does-not-exist")
    await expect(page.getByRole("heading", { level: 2, name: "Page not found" })).toBeVisible()
    await expect(page.getByText("This page doesn't exist or may have been moved.")).toBeVisible()
    await expect(page.getByRole("link", { name: "Go Home" })).toBeVisible()
  })
})

test.describe("tab titles", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("pages carry their own tab title", async ({ page }) => {
    await page.goto("/login")
    await expect(page).toHaveTitle("Sign In · FamilyChart")
  })
})
