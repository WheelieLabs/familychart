import { join } from "node:path"
import bcrypt from "bcryptjs"
import Database from "better-sqlite3-multiple-ciphers"
import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

const BACKUP_NOTICE = "Backups taken before this erase may still contain this person."

function unique(prefix: string): string {
  return `${prefix}${Math.floor(Math.random() * 1_000_000)}`
}

async function createInactivePerson(request: APIRequestContext, name: string): Promise<number> {
  const created = await request.post("/api/people", { data: { name, date_of_birth: "1990-01-01" } })
  expect(created.ok(), await created.text()).toBeTruthy()
  const person = (await created.json()) as { id: number }
  const reading = await request.post("/api/observations", {
    data: {
      person_id: person.id,
      observation_type: "Weight",
      value: 70,
      unit: "kg",
      recorded_at: new Date(Date.now() - 3600_000).toISOString(),
    },
  })
  expect(reading.ok(), await reading.text()).toBeTruthy()
  const removed = await request.delete(`/api/people/${person.id}`)
  expect(removed.ok(), await removed.text()).toBeTruthy()
  return person.id
}

test("export then erase shows the guard, then the backup notice", async ({ page, request }) => {
  const name = unique("Quinn")
  const id = await createInactivePerson(request, name)
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route(`**/api/people/${id}/export`, async route => {
    await gate
    await route.continue()
  })

  await page.goto(`/admin/export/${id}/erase`)
  await expect(page.getByRole("heading", { level: 1, name: "Erase Person" })).toBeVisible()
  await expect(page.locator("p.fc-section-copy", { hasText: "0 doses, 1 observation, 0 test results with reports, 0 photos" })).toBeVisible()
  await expect(page.locator(".fc-banner__body", { hasText: BACKUP_NOTICE })).toBeVisible()
  await expect(page.locator("[data-live-region=polite]")).toContainText(BACKUP_NOTICE)

  const nameField = page.getByRole("textbox", { name: "Type their name" })
  await nameField.fill("Nope")
  await nameField.press("Tab")
  await expect(page.getByText(`Type ${name} exactly.`)).toBeVisible()
  await expect(page.locator("[data-live-region=assertive]")).toContainText("Type their name")

  await nameField.fill(name)
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download export first" }).click()
  await expect(page.getByText("An export of this person is still downloading.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Erase" })).toBeDisabled()
  release()
  await download
  await expect(page.getByText("An export of this person is still downloading.")).toBeHidden()

  await page.getByRole("button", { name: "Download export first" }).focus()
  await page.keyboard.press("Tab")
  await expect(page.getByRole("button", { name: "Erase" })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByText("If you ever restore a backup taken before this date, erase this person again.")).toBeVisible()
  await expect(page.locator("p.fc-section-copy", { hasText: BACKUP_NOTICE })).toBeVisible()
})

test("Reactivate puts a removed Person back on the family list", async ({ page, request }) => {
  const name = unique("Pat")
  await createInactivePerson(request, name)
  await page.goto("/admin/export")
  await page.getByRole("button", { name: `Reactivate ${name}` }).click()
  await expect(page.getByRole("button", { name: `Reactivate ${name}` })).toHaveCount(0)
  await expect(page.getByRole("button", { name: `Erase ${name}` })).toHaveCount(0)
  await expect(page.getByText(name, { exact: true })).toBeVisible()
})

test("a None-role Account can erase their own Person and is signed out", async ({ browser }) => {
  const name = unique("Casey")
  const email = `${name.toLowerCase()}@example.com`
  const password = "ui-test-password-1"
  const db = new Database(join(process.env.FC_UI_TEST_DIR!, "familychart.db"))
  db.pragma("busy_timeout = 5000")
  const account = db.prepare(
    `INSERT INTO accounts (email, password_hash, role, is_active, status, auth_method, session_version)
     VALUES (?, ?, 'none', 1, 'active', 'local', 0)`,
  ).run(email, bcrypt.hashSync(password, 4))
  const accountId = Number(account.lastInsertRowid)
  db.prepare(
    "INSERT INTO people (name, is_active, account_uid) VALUES (?, 1, ?)",
  ).run(name, `local:${accountId}`)
  db.close()

  const context = await browser.newContext()
  const api = context.request
  const csrf = (await (await api.get("/api/auth/csrf")).json()) as { csrfToken: string }
  const signIn = await api.post("/api/auth/callback/credentials", {
    form: { csrfToken: csrf.csrfToken, email, password, json: "true" },
  })
  expect(signIn.ok(), await signIn.text()).toBeTruthy()

  const page: Page = await context.newPage()
  await page.goto("/profile?tab=account")
  await page.getByRole("button", { name: "Erase my records" }).click()
  await expect(page.getByText("This takes you off the family list and erases your records in one step.")).toBeVisible()
  await expect(page.locator(".fc-banner__body", { hasText: BACKUP_NOTICE })).toBeVisible()
  await page.getByRole("textbox", { name: "Type their name" }).fill(name)
  await page.getByLabel("Password for this erase").fill(password)
  await page.getByRole("button", { name: "Erase" }).click()
  await expect(page.getByRole("paragraph").filter({ hasText: "This account has been permanently removed." })).toBeVisible()

  await page.goto("/")
  await expect(page).toHaveURL(/\/login/)

  const check = new Database(join(process.env.FC_UI_TEST_DIR!, "familychart.db"))
  check.pragma("busy_timeout = 5000")
  expect(check.prepare("SELECT id FROM accounts WHERE id = ?").get(accountId)).toBeUndefined()
  expect(check.prepare("SELECT id FROM people WHERE name = ?").get(name)).toBeUndefined()
  check.close()
  await context.close()
})
