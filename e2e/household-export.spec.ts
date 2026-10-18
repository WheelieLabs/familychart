import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "@playwright/test"

function saveZip(zip: Buffer): string {
  const path = join(mkdtempSync(join(tmpdir(), "fc-e2e-household-")), "export.zip")
  writeFileSync(path, zip)
  return path
}

function unzipEntry(zip: Buffer, name: string): string {
  return execFileSync("unzip", ["-p", saveZip(zip), name], { encoding: "utf8" })
}

function entryNames(zip: Buffer): string[] {
  return execFileSync("unzip", ["-Z1", saveZip(zip)], { encoding: "utf8" }).trim().split("\n")
}

test("Download household export saves a zip whose manifest names the household", async ({ page }) => {
  await page.goto("/admin/export")
  await expect(page.getByText(/health information/i)).toBeVisible()
  await expect(page.getByRole("button", { name: "Download household export" })).toBeVisible()

  await page.getByRole("button", { name: "Download household export" }).click()
  const dialog = page.getByRole("dialog", { name: "Download household export" })
  await expect(dialog.getByText("This file is not encrypted and holds health information. Store it somewhere private.")).toBeVisible()
  const downloadPromise = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "Download" }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe("household-export.zip")
  const zip = readFileSync((await download.path())!)

  const names = entryNames(zip)
  expect(names[0]).toBe("manifest.json")
  expect(names).toContain("household.json")
  expect(names.some(name => name.startsWith("people/") && name.endsWith("/person.json"))).toBe(true)
  expect(names.some(name => /alex|sam|robin/i.test(name))).toBe(false)

  const manifest = JSON.parse(unzipEntry(zip, "manifest.json")) as { scope: string; format_version: number; counts: { people: number } }
  expect(manifest).toMatchObject({ scope: "household", format_version: 2 })
  expect(manifest.counts.people).toBe(3)
})

test("protecting a download shows the passphrase once and waits until it is saved", async ({ page }) => {
  await page.goto("/admin/export")
  await page.getByRole("button", { name: "Download household export" }).click()
  const dialog = page.getByRole("dialog", { name: "Download household export" })
  await dialog.getByRole("checkbox", { name: "Protect this file with a passphrase" }).check()
  await expect(dialog.getByText("We do not keep it")).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Download" })).toBeDisabled()
  await dialog.getByRole("checkbox", { name: "I've saved the passphrase" }).check()
  const downloadPromise = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "Download" }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe("household-export.zip")
})
