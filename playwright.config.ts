import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defineConfig } from "@playwright/test"
import { BASE_URL } from "./e2e/server"

// One scratch instance per run, so the tests never touch data/familychart.db. The variable is set
// before Playwright starts its workers, which inherit it.
process.env.FC_UI_TEST_DIR ??= mkdtempSync(join(tmpdir(), "familychart-ui-"))

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  outputDir: "test-results",
  // The Entra warning needs Entra switched on in System Settings, which changes the sign-in page and
  // the Administration overview for every other test. So that file runs alone, after all the others.
  // Person erase creates and removes people in the shared database, so it runs after the export
  // checks that count the seeded household.
  projects: [
    { name: "default", testIgnore: [/entra-gap\.spec\.ts/, /person-erase\.spec\.ts/] },
    { name: "person-erase", testMatch: /person-erase\.spec\.ts|account-removal\.spec\.ts/, dependencies: ["default"] },
    { name: "entra-gap", testMatch: /entra-gap\.spec\.ts/, dependencies: ["person-erase"] },
  ],
  use: {
    baseURL: BASE_URL,
    storageState: "e2e/.auth/admin.json",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
})
