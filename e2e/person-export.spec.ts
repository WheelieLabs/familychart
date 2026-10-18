import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { SEED_FILE, type Seed } from "./global-setup"

const seed = JSON.parse(readFileSync(SEED_FILE, "utf8")) as Seed

function unzipEntry(zip: Buffer, name: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "fc-e2e-export-")), "export.zip")
  writeFileSync(path, zip)
  return execFileSync("unzip", ["-p", path, name], { encoding: "utf8" })
}

function entryNames(zip: Buffer): string[] {
  const path = join(mkdtempSync(join(tmpdir(), "fc-e2e-export-")), "export.zip")
  writeFileSync(path, zip)
  return execFileSync("unzip", ["-Z1", path], { encoding: "utf8" }).trim().split("\n")
}

test("the seeded household exports a Person with their history, rules and report", async ({ request }) => {
  const res = await request.get(`/api/people/${seed.people[0].id}/export`)
  expect(res.status()).toBe(200)
  expect(res.headers()["content-type"]).toBe("application/zip")
  const zip = await res.body()
  const names = entryNames(zip)
  expect(names[0]).toBe("manifest.json")
  expect(names).toContain("attachments/report-1.pdf")

  const payload = JSON.parse(unzipEntry(zip, "person.json"))
  expect(payload.person.name).toBe("Alex")
  expect(payload.medications[0].frequency_rules).toHaveLength(1)
  expect(payload.assignments).toHaveLength(1)
  expect(payload.administrations).toHaveLength(1)
  expect(payload.observations).toHaveLength(1)
  expect(payload.test_results[0].values[0].metric_name).toBe("Ferritin")
  expect(payload.symptom_dose_links).toHaveLength(1)
})

test("the seeded household exports a Person with a schedule and a blood pressure reading", async ({ request }) => {
  const res = await request.get(`/api/people/${seed.people[1].id}/export`)
  expect(res.status()).toBe(200)
  const payload = JSON.parse(unzipEntry(await res.body(), "person.json"))
  expect(payload.assignments[0].schedule_times).toBe('["08:00","20:00"]')
  const groups = payload.observations.map((o: { group_id: number | null }) => o.group_id)
  expect(groups).toHaveLength(2)
  expect(groups[0]).not.toBeNull()
  expect(groups[1]).toBe(groups[0])
})

test("the seeded inactive Person exports", async ({ request }) => {
  const res = await request.get(`/api/people/${seed.inactivePerson.id}/export`)
  expect(res.status()).toBe(200)
  expect(JSON.parse(unzipEntry(await res.body(), "person.json")).person).toMatchObject({ name: "Robin", is_active: 0 })
})
