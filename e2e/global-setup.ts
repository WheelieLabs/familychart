import { mkdirSync, writeFileSync } from "node:fs"
import { chromium, type FullConfig } from "@playwright/test"
import { startServer } from "./server"

export const ADMIN = { email: "admin@example.com", password: "ui-test-password-1" }
export const SEED_FILE = "e2e/.auth/seed.json"

export interface Seed {
  /** The active people. */
  people: { id: number; name: string }[]
  inactivePerson: { id: number; name: string }
  medicationId: number
}

/**
 * Builds the seeded instance through the app's own API: the first administrator, a signed-in
 * session saved for the tests, then the household the export and restore tests share: two
 * people, medications with frequency rules and schedules, doses, observations (one a blood
 * pressure pair), a test result with a report, a symptom linked to a dose and an inactive person.
 */
export default async function globalSetup(config: FullConfig) {
  const stopServer = await startServer()
  const baseURL = config.projects[0].use.baseURL!
  mkdirSync("e2e/.auth", { recursive: true })

  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL })
  const api = context.request

  const bootstrap = await api.post("/api/setup/bootstrap", {
    data: { email: ADMIN.email, password: ADMIN.password, confirmPassword: ADMIN.password },
  })
  // 403 means a re-used instance (FC_UI_REUSE_SERVER) that an earlier run already seeded.
  if (bootstrap.status() !== 201 && bootstrap.status() !== 403) {
    throw new Error(`Bootstrap failed: ${bootstrap.status()} ${await bootstrap.text()}`)
  }

  // Sign in through the credentials endpoint. The login page is not used because every page
  // redirects to the setup wizard until setup is complete.
  const csrf = (await (await api.get("/api/auth/csrf")).json()) as { csrfToken: string }
  const signIn = await api.post("/api/auth/callback/credentials", {
    form: { csrfToken: csrf.csrfToken, email: ADMIN.email, password: ADMIN.password, json: "true" },
  })
  if (!signIn.ok()) throw new Error(`Sign in failed: ${signIn.status()} ${await signIn.text()}`)

  const send = async (method: "post" | "put" | "delete", path: string, data?: object) => {
    const res = await api[method](path, data ? { data } : {})
    if (!res.ok()) throw new Error(`${method.toUpperCase()} ${path} failed: ${res.status()} ${await res.text()}`)
    return (await res.json()) as { id: number }
  }
  const post = (path: string, data: object) => send("post", path, data)
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString()

  await post("/api/setup/complete", { timezone: "Europe/London" })

  const people = [
    await post("/api/people", { name: "Alex", date_of_birth: "2015-04-02" }),
    await post("/api/people", { name: "Sam", date_of_birth: "2019-09-30" }),
  ]
  const medications = [
    await post("/api/medications", { name: "Paracetamol", default_dosage: 250, dosage_unit: "mg" }),
    await post("/api/medications", { name: "Ibuprofen", default_dosage: 200, dosage_unit: "mg" }),
  ]
  // Alex's pages are scanned by the axe and layout tests, so nothing on Alex depends on the time
  // of day: the frequency rule window is shorter than the age of Alex's dose and the scheduled
  // assignment and the blood pressure pair belong to Sam.
  await post(`/api/medications/${medications[0].id}/frequency-rules`, { min_hours_between: 2, max_quantity_per_24h: 1000 })
  await post(`/api/medications/${medications[1].id}/frequency-rules`, { min_hours_between: 6, max_quantity_per_24h: 3, max_per_24h_count_doses: true })
  await post(`/api/people/${people[0].id}/person-medications`, { medication_id: medications[0].id })
  await post(`/api/people/${people[1].id}/person-medications`, {
    medication_id: medications[1].id,
    schedule_times: ["08:00", "20:00"],
    schedule_frequency: { kind: "daily" },
    schedule_start_date: hoursAgo(24 * 30).slice(0, 10),
  })

  const dose = await post("/api/records", {
    person_id: people[0].id,
    medication_id: medications[0].id,
    recorded_at: hoursAgo(3),
    dosage: 250,
    dosage_unit: "mg",
  })
  await post("/api/records", {
    person_id: people[1].id,
    medication_id: medications[1].id,
    recorded_at: hoursAgo(5),
    dosage: 200,
    dosage_unit: "mg",
  })

  await post("/api/observations", { person_id: people[0].id, observation_type: "Weight", value: 24.5, unit: "kg", recorded_at: hoursAgo(4) })
  for (const [value, value_label] of [[118, "systolic"], [76, "diastolic"]] as const) {
    await post("/api/observations", {
      person_id: people[1].id,
      observation_type: "Blood Pressure",
      value,
      unit: "mmHg",
      value_label,
      session_id: "seed-bp-1",
      recorded_at: hoursAgo(4),
    })
  }

  const upload = await api.post("/api/test-results/upload", {
    multipart: {
      file: { name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") },
      person_id: String(people[0].id),
    },
  })
  if (!upload.ok()) throw new Error(`Report upload failed: ${upload.status()} ${await upload.text()}`)
  const { url: reportUrl } = (await upload.json()) as { url: string }
  await post("/api/test-events", {
    person_id: people[0].id,
    test_type: "Blood",
    name: "Iron studies",
    date: hoursAgo(24),
    ordered_by: "Dr Smith",
    attachment_url: reportUrl,
    values: [{ metric_name: "Ferritin", value_type: "numeric", numeric_value: 30, unit: "ug/L", other: true }],
  })

  const symptom = await post("/api/symptom-events", {
    person_id: people[0].id,
    label: "Fever",
    start_date: new Date().toISOString().slice(0, 10),
    severity: 3,
  })
  await send("put", "/api/symptom-dose-links", { person_id: people[0].id, symptom_id: symptom.id, add_record_ids: [dose.id] })

  const inactive = await post("/api/people", { name: "Robin", date_of_birth: "1950-01-01" })
  await send("delete", `/api/people/${inactive.id}`)

  const seed: Seed = {
    people: [
      { id: people[0].id, name: "Alex" },
      { id: people[1].id, name: "Sam" },
    ],
    inactivePerson: { id: inactive.id, name: "Robin" },
    medicationId: medications[0].id,
  }
  writeFileSync(SEED_FILE, JSON.stringify(seed))
  await context.storageState({ path: "e2e/.auth/admin.json" })
  await browser.close()
  return stopServer
}
