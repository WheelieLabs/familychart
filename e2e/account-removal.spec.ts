import { createHash } from "node:crypto"
import { join } from "node:path"
import Database from "better-sqlite3-multiple-ciphers"
import { expect, test, type APIRequestContext } from "@playwright/test"
import { ADMIN } from "./global-setup"

const LAST_LOCAL_ADMIN = "Cannot remove the last local Admin"

function uiDb(): Database.Database {
  return new Database(join(process.env.FC_UI_TEST_DIR!, "familychart.db"))
}

function insertAccount(email: string, role: string): number {
  const db = uiDb()
  try {
    const row = db.prepare(
      "INSERT INTO accounts (email, password_hash, role, auth_method, status) VALUES (?, 'hash', ?, 'local', 'active')",
    ).run(email, role)
    return Number(row.lastInsertRowid)
  } finally {
    db.close()
  }
}

function linkPerson(personId: number, accountId: number) {
  const db = uiDb()
  try {
    db.prepare("UPDATE people SET account_uid = ? WHERE id = ?").run(`local:${accountId}`, personId)
  } finally {
    db.close()
  }
}

async function inactivePerson(request: APIRequestContext, name: string): Promise<number> {
  const created = await request.post("/api/people", { data: { name, date_of_birth: "1990-01-01" } })
  expect(created.ok(), await created.text()).toBeTruthy()
  const person = (await created.json()) as { id: number }
  const removed = await request.delete(`/api/people/${person.id}`)
  expect(removed.ok(), await removed.text()).toBeTruthy()
  return person.id
}

test("an Admin types the email to remove another account, and cannot remove the last local Admin", async ({ page }) => {
  const email = `carer${Date.now()}@example.com`
  insertAccount(email, "write")

  await page.goto("/admin/accounts")
  await expect(page.getByRole("button", { name: `Remove ${ADMIN.email}` })).toBeDisabled()
  await page.getByRole("button", { name: `Edit ${ADMIN.email}` }).click()
  await expect(page.getByText(LAST_LOCAL_ADMIN)).toBeVisible()
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: `Remove ${email}` }).click()
  const dialog = page.getByRole("dialog", { name: "Remove account" })
  await expect(dialog.getByRole("heading", { name: "Remove account" })).toBeVisible()
  await expect(dialog.getByText("Removing an account cannot be undone.")).toBeVisible()
  const confirm = page.getByRole("button", { name: "Remove account" })
  await expect(confirm).toBeDisabled()
  await page.getByRole("textbox", { name: "Type their email" }).fill("wrong@example.com")
  await expect(confirm).toBeDisabled()
  await page.getByRole("textbox", { name: "Type their email" }).fill(email)
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await expect(page.getByText(email)).toHaveCount(0)
})

test("Person erase offers to remove a linked Account, on for Role None", async ({ page, request }) => {
  const name = `Riley${Date.now()}`
  const personId = await inactivePerson(request, name)
  const accountId = insertAccount(`none${Date.now()}@example.com`, "none")
  linkPerson(personId, accountId)

  await page.goto(`/admin/export/${personId}/erase`)
  const remove = page.getByRole("switch", { name: "Also permanently remove their Account" })
  await expect(remove).toHaveAttribute("aria-checked", "true")
  await expect(remove).toBeEnabled()

  await page.getByRole("textbox", { name: "Type their name" }).fill(name)
  await page.getByRole("button", { name: "Erase" }).click()
  await expect(page.getByText("This account has been permanently removed.")).toBeVisible()
})

test("a tombstoned Entra sign-in sees that the account was removed, and an Admin can allow them back", async ({ page, browser }) => {
  const hash = createHash("sha256").update(`oid-${Date.now()}`).digest("hex")
  const db = uiDb()
  try {
    db.prepare("INSERT INTO entra_removed_accounts (oid_hash, removed_at) VALUES (?, ?)").run(
      hash,
      new Date().toISOString(),
    )
  } finally {
    db.close()
  }

  await page.goto("/admin/entra-sessions")
  await expect(page.getByRole("heading", { name: "Removed accounts" })).toBeVisible()
  await page.getByRole("button", { name: "Allow this person back" }).click()
  await expect(page.getByRole("heading", { name: "Removed accounts" })).toHaveCount(0)

  const signedOut = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const visitor = await signedOut.newPage()
  await visitor.goto("/account-removed")
  await expect(visitor.getByRole("heading", { name: "Your account was removed" })).toBeVisible()
  await expect(visitor.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0)
  await signedOut.close()
})

test("a disabled Remove reason wraps inside the card on a phone", async ({ page, request }) => {
  const personId = await inactivePerson(request, `Linked${Date.now()}`)
  const email = `lk${Date.now() % 1000000}@example.com`
  const accountId = insertAccount(email, "none")
  linkPerson(personId, accountId)

  try {
    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto("/admin/accounts")
    await expect(page.getByRole("button", { name: `Remove ${email}` })).toBeDisabled()
    await expect(page.getByText("This account is still linked to a Person").first()).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    // The email keeps a readable width: no more than two lines at the title's font size.
    const title = page.getByText(email, { exact: true }).first()
    const box = (await title.boundingBox())!
    expect(box.height).toBeLessThan(60)
  } finally {
    // Leave the shared instance as found: other specs assert exact Person and Account counts.
    const db = uiDb()
    try {
      db.prepare("UPDATE people SET account_uid = NULL WHERE id = ?").run(personId)
      db.prepare("DELETE FROM accounts WHERE id = ?").run(accountId)
      db.prepare("DELETE FROM people WHERE id = ?").run(personId)
    } finally {
      db.close()
    }
  }
})
