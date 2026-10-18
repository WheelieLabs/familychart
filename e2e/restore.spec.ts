import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type APIRequestContext, type Page } from "@playwright/test"
import { TAGS } from "./axe-config"
import { ADMIN } from "./global-setup"
import { loadSeed } from "./routes"
import { serverEnv } from "./server"

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

/** A second FamilyChart with its own database, so restore does not change the shared seed. */
async function startInstance(): Promise<{ baseURL: string; stop: () => Promise<void> }> {
  const port = await freePort()
  const dir = mkdtempSync(join(tmpdir(), "fc-restore-ui-"))
  const baseURL = `http://127.0.0.1:${port}`
  const child: ChildProcess = spawn("npx", ["next", "start", "--port", String(port)], {
    env: { ...serverEnv(), DB_PATH: join(dir, "familychart.db"), NEXTAUTH_URL: baseURL, AUTH_URL: baseURL },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  })
  let log = ""
  const keep = (chunk: Buffer) => { log = (log + chunk.toString()).slice(-4000) }
  child.stdout?.on("data", keep)
  child.stderr?.on("data", keep)
  const stop = async () => {
    try { process.kill(-child.pid!, "SIGTERM") } catch { /* already gone */ }
  }
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(1000) })
      if (res.ok) return { baseURL, stop }
    } catch { /* still starting */ }
    if (child.exitCode !== null) {
      await stop()
      throw new Error(`Restore instance exited ${child.exitCode}: ${log}`)
    }
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  await stop()
  throw new Error(`Restore instance did not answer /api/health: ${log}`)
}

async function signIn(api: APIRequestContext) {
  const bootstrap = await api.post("/api/setup/bootstrap", {
    data: { email: ADMIN.email, password: ADMIN.password, confirmPassword: ADMIN.password },
  })
  expect(bootstrap.status(), await bootstrap.text()).toBe(201)
  const csrf = (await (await api.get("/api/auth/csrf")).json()) as { csrfToken: string }
  const signedIn = await api.post("/api/auth/callback/credentials", {
    form: { csrfToken: csrf.csrfToken, email: ADMIN.email, password: ADMIN.password, json: "true" },
  })
  expect(signedIn.ok(), await signedIn.text()).toBe(true)
  const setup = await api.post("/api/setup/complete", { data: { timezone: "Europe/London" } })
  expect(setup.ok(), await setup.text()).toBe(true)
}

async function exportAlex(source: APIRequestContext): Promise<string> {
  const alex = loadSeed().people.find(person => person.name === "Alex") ?? loadSeed().people[0]
  const res = await source.get(`/api/people/${alex.id}/export`)
  expect(res.status()).toBe(200)
  const file = join(mkdtempSync(join(tmpdir(), "fc-restore-zip-")), "alex.zip")
  writeFileSync(file, await res.body())
  return file
}

async function exportHousehold(source: APIRequestContext): Promise<string> {
  const res = await source.get("/api/export/household")
  expect(res.status()).toBe(200)
  const file = join(mkdtempSync(join(tmpdir(), "fc-restore-zip-")), "household.zip")
  writeFileSync(file, await res.body())
  return file
}

/** Steps through the restore with Next until the Review and apply step is showing. */
async function toReview(page: Page) {
  await expect(page.getByRole("heading", { name: /^Step \d+ of \d+: / })).toBeVisible()
  const next = page.getByRole("button", { name: "Next" })
  while (await next.isVisible()) await next.click()
  await expect(page.getByRole("heading", { name: /: Review and apply$/ })).toBeVisible()
}

async function confirmAndApply(page: Page) {
  await toReview(page)
  const reviewed = page.getByRole("checkbox", { name: "I have reviewed this preview" })
  await reviewed.focus()
  await page.keyboard.press("Space")
  await expect(reviewed).toBeChecked()
  await page.getByRole("button", { name: "Apply restore" }).focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("heading", { name: "Restore complete" })).toBeVisible()
  await expect(page.locator("[data-live-region=polite]")).toContainText("Restore complete")
}

test("a phone sees Desktop Required and can still download", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto("/admin/export?tab=restore")
  await expect(page.getByRole("heading", { name: "Desktop Required" })).toBeVisible()
  await expect(page.getByText(/desktop browser/)).toBeVisible()
  await page.getByRole("tab", { name: "Export" }).click()
  await expect(page.getByRole("button", { name: "Download export for Alex" })).toBeVisible()
  await page.getByRole("tab", { name: "Restore" }).click()
  await expect(page.getByRole("button", { name: "Choose file" })).toHaveCount(0)
})

test("an admin restores a Person export into an existing household", async ({ browser, request }) => {
  test.setTimeout(180_000)
  const file = await exportAlex(request)
  const instance = await startInstance()
  try {
    const context = await browser.newContext({ baseURL: instance.baseURL })
    const api = context.request
    await signIn(api)
    expect((await api.post("/api/people", { data: { name: "Alex", date_of_birth: "2015-04-02" } })).ok()).toBe(true)
    expect((await api.post("/api/medications", { data: { name: "Paracetamol", default_dosage: 250, dosage_unit: "mg" } })).ok()).toBe(true)
    const page = await context.newPage()
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto("/admin/export?tab=restore")
    await page.locator("#restore-file").setInputFiles(file)

    const group = page.getByRole("radiogroup", { name: "What to do with Alex" })
    await expect(group.getByRole("radio", { name: "Map to existing" })).toBeChecked()
    await expect(page.getByText("2 Apr 2015").first()).toBeVisible()
    await group.getByRole("radio", { name: "Map to existing" }).focus()
    await page.keyboard.press("ArrowRight")
    await expect(group.getByRole("radio", { name: "Skip" })).toBeChecked()
    await page.keyboard.press("ArrowLeft")
    await expect(group.getByRole("radio", { name: "Map to existing" })).toBeChecked()

    await page.getByRole("button", { name: "Next" }).click()
    const medication = page.getByRole("radiogroup", { name: "What to do with Paracetamol" })
    await medication.getByRole("radio", { name: "Map to existing" }).focus()
    await page.keyboard.press("ArrowLeft")
    await expect(medication.getByRole("radio", { name: "New" })).toBeChecked()
    await page.keyboard.press("ArrowRight")
    await expect(medication.getByRole("radio", { name: "Map to existing" })).toBeChecked()

    await confirmAndApply(page)
    await expect(page.getByRole("region", { name: "Restore" }).getByText("Mapped Alex onto an existing person.")).toBeVisible()
    const people = await (await api.get("/api/people")).json() as { name: string }[]
    expect(people.filter(person => person.name === "Alex")).toHaveLength(1)
    await context.close()
  } finally {
    await instance.stop()
  }
})

test("an admin restores a household export into a fresh instance", async ({ browser, request }) => {
  test.setTimeout(180_000)
  const file = await exportHousehold(request)
  const instance = await startInstance()
  try {
    const context = await browser.newContext({ baseURL: instance.baseURL })
    const api = context.request
    await signIn(api)
    const page = await context.newPage()
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto("/admin/export?tab=restore")
    await page.locator("#restore-file").setInputFiles(file)

    for (const name of ["Alex", "Sam", "Robin"]) {
      const group = page.getByRole("radiogroup", { name: `What to do with ${name}` })
      await expect(group.getByRole("radio", { name: "New" })).toBeChecked()
      await group.getByRole("radio", { name: "New" }).focus()
      await page.keyboard.press("ArrowRight")
      await expect(group.getByRole("radio", { name: "Map to existing" })).toBeChecked()
      await page.keyboard.press("ArrowLeft")
      await expect(group.getByRole("radio", { name: "New" })).toBeChecked()
    }

    await confirmAndApply(page)
    await expect(page.getByRole("region", { name: "Restore" }).getByText(/Created Alex, Sam, Robin/)).toBeVisible()
    await expect(page.getByRole("region", { name: "Restore" }).getByText(/Accounts will not be restored: outbound email isn't configured/)).toBeVisible()
    const people = await (await api.get("/api/people?include_inactive=1")).json() as { name: string; is_active: number }[]
    expect(people.map(person => person.name).sort()).toEqual(["Alex", "Robin", "Sam"])
    expect(people.find(person => person.name === "Robin")?.is_active).toBe(0)
    await context.close()
  } finally {
    await instance.stop()
  }
})

test("an admin restores a Person export into a fresh instance", async ({ browser, request }) => {
  test.setTimeout(180_000)
  const file = await exportAlex(request)
  const instance = await startInstance()
  try {
    const context = await browser.newContext({ baseURL: instance.baseURL })
    const api = context.request
    await signIn(api)
    const page = await context.newPage()
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto("/admin/export?tab=restore")
    await page.locator("#restore-file").setInputFiles(file)
    const group = page.getByRole("radiogroup", { name: "What to do with Alex" })
    await expect(group.getByRole("radio", { name: "New" })).toBeChecked()
    await confirmAndApply(page)
    await expect(page.getByRole("region", { name: "Restore" }).getByText(/Created Alex/)).toBeVisible()
    const people = await (await api.get("/api/people")).json() as { name: string; date_of_birth: string }[]
    expect(people).toEqual([expect.objectContaining({ name: "Alex", date_of_birth: "2015-04-02" })])
    await context.close()
  } finally {
    await instance.stop()
  }
})

test("Person Sign-in covers a blank field, a new invite, an existing Account, a linked Account and Entra", async ({ browser, request }) => {
  test.setTimeout(180_000)
  const alex = await exportAlex(request)
  const sam = loadSeed().people.find(person => person.name === "Sam") ?? loadSeed().people[1]
  const samRes = await request.get(`/api/people/${sam.id}/export`)
  expect(samRes.status()).toBe(200)
  const samFile = join(mkdtempSync(join(tmpdir(), "fc-restore-zip-")), "sam.zip")
  writeFileSync(samFile, await samRes.body())

  const instance = await startInstance()
  try {
    const context = await browser.newContext({ baseURL: instance.baseURL })
    const api = context.request
    await signIn(api)
    const page = await context.newPage()
    await page.setViewportSize({ width: 1280, height: 1800 })
    await page.goto("/admin/export?tab=restore")
    await page.locator("#restore-file").setInputFiles(alex)
    const email = page.getByRole("textbox", { name: "Sign-in for this Person (optional)" })
    await expect(email).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Household Role" })).toHaveValue("none")
    const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
    expect(violations.map(v => `${v.id}: ${v.help}`)).toEqual([])

    await confirmAndApply(page)
    const restore = page.getByRole("region", { name: "Restore" })
    await expect(restore.getByText("personal settings not carried: no sign-in given")).toBeVisible()

    await page.goto("/admin/export?tab=restore")
    await page.locator("#restore-file").setInputFiles(alex)
    await email.fill(ADMIN.email)
    await confirmAndApply(page)
    await expect(restore.getByText("Linked the existing Account. No invite was sent.")).toBeVisible()

    await page.goto("/admin/export?tab=restore")
    await page.locator("#restore-file").setInputFiles(samFile)
    await email.fill(ADMIN.email)
    await toReview(page)
    await page.getByRole("checkbox", { name: "I have reviewed this preview" }).check()
    await page.getByRole("button", { name: "Apply restore" }).click()
    await expect(restore.getByText("This account already has a Personal-link to someone else.")).toBeVisible()

    await email.fill("sam-moved@example.com")
    await toReview(page)
    await page.getByRole("checkbox", { name: "I have reviewed this preview" }).check()
    await page.getByRole("button", { name: "Apply restore" }).click()
    await expect(page.getByRole("heading", { name: "Restore complete" })).toBeVisible()
    await expect(restore.getByText("The invite was created but not sent. Send it later from Administration → Accounts.")).toBeVisible()

    for (const [key, value] of Object.entries({
      "auth.entra.enabled": "true",
      "auth.entra.client_id": "ui-test-client",
      "auth.entra.tenant_id": "ui-test-tenant",
      "auth.entra.client_secret": "ui-test-secret",
    })) {
      const res = await api.patch("/api/app-settings", { data: { key, value } })
      expect(res.ok(), `${key}: ${res.status()} ${await res.text()}`).toBe(true)
    }
    await page.goto("/admin/export?tab=restore")
    await page.locator("#restore-file").setInputFiles(samFile)
    await page.getByRole("radiogroup", { name: "What to do with Sam" }).getByRole("radio", { name: "New" }).check()
    await email.fill("entra-sam@example.com")
    await confirmAndApply(page)
    await expect(restore.getByText("This instance also uses Entra sign-in — they can set a password from the invite, or sign in with Entra using the same email.")).toBeVisible()
    await context.close()
  } finally {
    await instance.stop()
  }
})

test("a fresh instance restores from the setup person step and finishes without a separate first person", async ({ browser, request }) => {
  test.setTimeout(180_000)
  const file = await exportAlex(request)
  const instance = await startInstance()
  try {
    const context = await browser.newContext({ baseURL: instance.baseURL })
    const api = context.request
    const bootstrap = await api.post("/api/setup/bootstrap", {
      data: { email: ADMIN.email, password: ADMIN.password, confirmPassword: ADMIN.password },
    })
    expect(bootstrap.status(), await bootstrap.text()).toBe(201)
    const csrf = (await (await api.get("/api/auth/csrf")).json()) as { csrfToken: string }
    const signedIn = await api.post("/api/auth/callback/credentials", {
      form: { csrfToken: csrf.csrfToken, email: ADMIN.email, password: ADMIN.password, json: "true" },
    })
    expect(signedIn.ok(), await signedIn.text()).toBe(true)

    const page = await context.newPage()
    await page.setViewportSize({ width: 390, height: 800 })
    await page.goto("/setup")
    await expect(page.getByRole("heading", { name: "Add your first person" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Restore from an export instead" })).toHaveCount(0)

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.getByRole("link", { name: "Restore from an export instead" }).click()
    await expect(page).toHaveURL(/\/admin\/export\?tab=restore$/)
    await expect(page.getByRole("link", { name: "Continue setup" })).toBeVisible()
    await page.locator("#restore-file").setInputFiles(file)
    await confirmAndApply(page)

    await page.getByRole("link", { name: "Continue setup" }).click()
    await expect(page.getByRole("heading", { name: "Household timezone" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Add your first person" })).toHaveCount(0)
    await page.getByLabel("Timezone").fill("Europe/London")
    await page.getByRole("button", { name: "Continue" }).click()
    await page.getByRole("button", { name: "Skip for now" }).click()
    await expect(page).toHaveURL(/welcome=1/)

    const people = await (await api.get("/api/people")).json() as { name: string; date_of_birth: string }[]
    expect(people).toEqual([expect.objectContaining({ name: "Alex", date_of_birth: "2015-04-02" })])
    await context.close()
  } finally {
    await instance.stop()
  }
})

test("a protected export asks for the passphrase and a wrong one can be tried again", async ({ browser, request }) => {
  test.setTimeout(180_000)
  const alex = loadSeed().people.find(person => person.name === "Alex") ?? loadSeed().people[0]
  const passphrase = "23456ABCDEFGHJKLMNPQ"
  const res = await request.post(`/api/people/${alex.id}/export`, { data: { passphrase } })
  expect(res.status()).toBe(200)
  const file = join(mkdtempSync(join(tmpdir(), "fc-protected-zip-")), "alex.zip")
  writeFileSync(file, await res.body())
  const instance = await startInstance()
  try {
    const context = await browser.newContext({ baseURL: instance.baseURL })
    const api = context.request
    await signIn(api)
    const page = await context.newPage()
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto("/admin/export?tab=restore")
    await page.locator("#restore-file").setInputFiles(file)
    const field = page.getByRole("textbox", { name: "Passphrase" })
    await expect(field).toBeVisible()
    await field.fill("WRONGPASSPHRASEXXXX")
    await page.getByRole("button", { name: "Open export" }).click()
    await expect(page.locator(".fc-field__error").filter({ hasText: "That passphrase doesn't open this file" })).toBeVisible()
    await field.fill(passphrase)
    await page.getByRole("button", { name: "Open export" }).click()
    await expect(page.getByRole("radiogroup", { name: "What to do with Alex" })).toBeVisible()
    await context.close()
  } finally {
    await instance.stop()
  }
})
