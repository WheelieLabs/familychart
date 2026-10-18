// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import AdminExportPage from "@/app/(writable)/admin/export/export-page"
import LiveRegion from "@/components/ui/LiveRegion"
import { subscribeToAnnouncements } from "@/lib/announce"

vi.mock("@/components/AppFooter", () => ({ default: () => null }))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "unauthenticated", data: null }),
  signOut: vi.fn(),
}))
let tabParam = "restore"
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams({ tab: tabParam }),
}))

/** Walks the restore steps with Next until the named step heading is showing. */
function goToStep(title: string) {
  for (let i = 0; i < 6; i++) {
    if (screen.queryByRole("heading", { name: new RegExp(`: ${title}$`) })) return
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
  }
  throw new Error(`Never reached the ${title} step`)
}

function atWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width })
  window.matchMedia = ((query: string) => ({
    matches: query.includes("max-width") ? width < 1024 : width >= 1024,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
  })) as typeof window.matchMedia
}

beforeEach(() => {
  tabParam = "restore"
  atWidth(1280)
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("Restore on a narrow screen", () => {
  it("shows Desktop Required below 1024px and still lists downloads", async () => {
    atWidth(390)
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("include_inactive=1")) {
        return {
          ok: true,
          json: async () => [{
            id: 3, name: "Robin", full_name: null, photo_url: null, color: "#3311AA",
            sort_order: 0, is_active: 1, account_uid: null, date_of_birth: "1950-01-01",
          }],
        }
      }
      return { ok: true, json: async () => ({ role: "admin" }) }
    }))
    render(<AdminExportPage />)
    expect(await screen.findByRole("heading", { name: "Desktop Required" })).toBeTruthy()
    expect(screen.getByText(/desktop browser/)).toBeTruthy()
    const card = (await screen.findByText("Robin")).closest("li")
    expect(within(card as HTMLElement).getByRole("button", { name: "Download export for Robin", hidden: true })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Choose file" })).toBeNull()
  })
})

describe("Restore upload", () => {
  it("names the accepted type and the size limit on the file field", async () => {
    render(<AdminExportPage maxUploadMb={512} />)
    expect(await screen.findByText("A FamilyChart export (.zip), up to 512 MB.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Choose file" })).toBeTruthy()
  })

  it("shows each Person as New, Map to existing or Skip, with dates of birth side by side", async () => {
    const plan = {
      id: "abc",
      format_version: 1,
      scope: "person",
      app_version: "1.1.0",
      exported_at: "2026-10-01T00:00:00.000Z",
      persons: [
        { bundle_id: 1, name: "Alex", date_of_birth: "2015-04-02", suggested_action: "map", target_id: 7 },
      ],
      medications: [
        { bundle_id: 4, name: "Paracetamol", suggested_action: "map", target_id: 4 },
      ],
      differences: [{
        kind: "frequency_rule", medication: "Paracetamol", field: "min_hours_between", existing: 8, export: 4,
      }],
      warnings: [{
        kind: "date_of_birth_mismatch",
        name: "Alex",
        export_date_of_birth: "2015-04-02",
        existing_date_of_birth: "2000-01-01",
        existing_id: 7,
      }],
      counts: { new: 3, duplicate: 1, differing: 1, skipped: 0 },
      created: { persons: 0, medications: 0, administrations: 1 },
      duplicates: { administrations: 1 },
      skipped_unknown: [],
      mapped: { persons: 1, medications: 1 },
      accounts: "not restored",
      favourites: "not restored",
      settings: "not restored",
    }
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
      if (path.endsWith("/api/restore/upload") && init?.method === "POST") {
        return { ok: true, json: async () => ({ id: "staged1" }) }
      }
      if (path === "/api/restore/staged1") {
        return { ok: true, json: async () => plan }
      }
      if (path.includes("include_inactive=1") && path.includes("people")) {
        return {
          ok: true,
          json: async () => [
            { id: 7, name: "Alex", date_of_birth: "2000-01-01", is_active: 1, photo_url: null },
            { id: 8, name: "Sam", date_of_birth: "2000-01-01", is_active: 1, photo_url: null },
          ],
        }
      }
      if (path.includes("/api/medications")) {
        return { ok: true, json: async () => [{ id: 4, name: "Paracetamol", is_active: 1 }] }
      }
      return { ok: true, json: async () => [] }
    }))
    render(<AdminExportPage />)
    const input = document.querySelector("input[type=file]") as HTMLInputElement
    const file = new File(["zip"], "alex.zip", { type: "application/zip" })
    fireEvent.change(input, { target: { files: [file] } })

    const group = await screen.findByRole("radiogroup", { name: "What to do with Alex" })
    expect(within(group).getByRole("radio", { name: "New" })).toBeTruthy()
    expect(within(group).getByRole("radio", { name: "Map to existing" }).getAttribute("aria-checked")).toBe("true")
    expect(within(group).getByRole("radio", { name: "Skip" })).toBeTruthy()
    const dates = screen.getByRole("group", { name: "Alex, name and date of birth" })
    expect(within(dates).getByText("2 Apr 2015 · 11 yrs")).toBeTruthy()
    expect(within(dates).getByText("1 Jan 2000 · 26 yrs")).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "Existing person for Alex" })).toBeTruthy()
    expect(screen.getByText("The dates of birth differ.")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Step 2 of 4: People" })).toBeTruthy()
    expect(screen.queryByRole("radiogroup", { name: "What to do with Paracetamol" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByRole("heading", { name: "Step 3 of 4: Medications" })).toBeTruthy()
    expect(screen.getByRole("radiogroup", { name: "What to do with Paracetamol" })).toBeTruthy()
    expect(screen.queryByRole("radiogroup", { name: "What to do with Alex" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Back" }))
    expect(screen.getByRole("radiogroup", { name: "What to do with Alex" })).toBeTruthy()
    goToStep("Review and apply")
    expect(screen.getByText(/minimum hours between doses/)).toBeTruthy()
    expect(screen.getByText("3")).toBeTruthy()
    await waitFor(() => {
      const upload = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/api/restore/upload"))
      expect(upload?.[1]).toMatchObject({ method: "POST" })
      expect((upload?.[1] as RequestInit).body).toBe(file)
    })
  })
})

const PREVIEW = {
  id: "abc",
  persons: [
    { bundle_id: 1, name: "Alex", date_of_birth: "2015-04-02", suggested_action: "new" as const, target_id: null },
    { bundle_id: 2, name: "Robin", date_of_birth: null, suggested_action: "skip" as const, target_id: null },
  ],
  medications: [
    { bundle_id: 4, name: "Paracetamol", suggested_action: "map" as const, target_id: 4 },
  ],
  differences: [],
  warnings: [],
  counts: { new: 1, duplicate: 0, differing: 0, skipped: 1 },
  created: {},
  duplicates: {},
  skipped_unknown: [],
  mapped: { persons: 0, medications: 1 },
  accounts: "not restored",
  favourites: "not restored",
  settings: "not restored",
}

function stagePreview() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url)
    if (path.endsWith("/api/restore/upload")) return { ok: true, json: async () => ({ id: "staged1" }) }
    if (path === "/api/restore/staged1" && init?.method !== "POST") return { ok: true, json: async () => PREVIEW }
    if (path === "/api/restore/staged1/apply") {
      return {
        ok: true,
        json: async () => ({
          ...PREVIEW,
          persons: [
            { bundle_id: 1, name: "Alex", date_of_birth: "2015-04-02", suggested_action: "new", target_id: null },
            { bundle_id: 2, name: "Robin", date_of_birth: null, suggested_action: "skip", target_id: null },
          ],
          medications: [
            { bundle_id: 4, name: "Paracetamol", suggested_action: "new", target_id: null },
          ],
          created: { persons: 1, medications: 1, administrations: 2 },
          duplicates: { administrations: 1 },
          skipped_unknown: [{ catalogue: "test_metric", name: "Coeliac screen", count: 1 }],
        }),
      }
    }
    if (path.includes("/api/people")) {
      return { ok: true, json: async () => [{ id: 7, name: "Alex", date_of_birth: "2015-04-02", is_active: 1 }] }
    }
    if (path.includes("/api/medications")) {
      return { ok: true, json: async () => [{ id: 4, name: "Paracetamol", is_active: 1 }] }
    }
    return { ok: true, json: async () => [] }
  }))
}

async function uploadExport() {
  render(<><LiveRegion /><AdminExportPage /></>)
  const input = document.querySelector("input[type=file]") as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(["zip"], "alex.zip", { type: "application/zip" })] } })
  await screen.findByRole("radiogroup", { name: "What to do with Alex" })
}

describe("Restore apply", () => {
  it("stays unavailable until the preview is confirmed, then names what was created, skipped and not restored", async () => {
    stagePreview()
    await uploadExport()
    goToStep("Medications")
    const meds = screen.getByRole("radiogroup", { name: "What to do with Paracetamol" })
    fireEvent.click(within(meds).getByRole("radio", { name: "New" }))
    goToStep("Review and apply")
    const apply = screen.getByRole("button", { name: "Apply restore" })
    expect(apply).toHaveProperty("disabled", true)
    expect(screen.getByText("Confirm you have reviewed this preview.")).toBeTruthy()
    fireEvent.click(screen.getByRole("checkbox", { name: "I have reviewed this preview" }))
    expect(screen.getByRole("button", { name: "Apply restore" })).toHaveProperty("disabled", false)
    fireEvent.click(screen.getByRole("button", { name: "Apply restore" }))

    expect(await screen.findByRole("heading", { name: "Restore complete" })).toBeTruthy()
    expect(screen.getByText("Created Alex, Paracetamol and 2 doses.")).toBeTruthy()
    expect(screen.getByText("Skipped Robin.")).toBeTruthy()
    expect(screen.getByText("Skipped 1 dose already on this instance.")).toBeTruthy()
    expect(screen.getByText("Skipped 1 Coeliac screen (test metric). This instance does not have it.")).toBeTruthy()
    expect(screen.queryByText("Accounts were not restored.")).toBeNull()
    expect(screen.getByText("Favourites were not restored.")).toBeTruthy()
    expect(screen.getByText("Instance settings were not restored.")).toBeTruthy()

    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/apply"))
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
        persons: [
          { bundle_id: 1, action: "new", target_id: null },
          { bundle_id: 2, action: "skip", target_id: null },
        ],
        medications: [{ bundle_id: 4, action: "new", target_id: null }],
      })
    })
  })

  it("shows a settings diff in the preview and lists what favourites and settings restore did", async () => {
    const report = {
      ...PREVIEW,
      favourites: {
        created: 2,
        duplicates: 0,
        not_restored: [{ reason: "account not restored", count: 1 }],
      },
      settings: {
        applied: [{ key: "locale.measurement_system", value: "imperial" }],
        differences: [{
          key: "locale.default_timezone",
          label: "Default timezone",
          existing: "Australia/Adelaide",
          export: "Europe/London",
          reason: "kept" as const,
        }],
        skipped: [{ key: "email.smtp.password", reason: "secret" }],
        per_user: "not restored" as const,
      },
    }
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
      if (path.endsWith("/api/restore/upload")) return { ok: true, json: async () => ({ id: "staged1" }) }
      if (path === "/api/restore/staged1" && init?.method !== "POST") return { ok: true, json: async () => report }
      if (path === "/api/restore/staged1/apply") return { ok: true, json: async () => report }
      if (path.includes("/api/people")) return { ok: true, json: async () => [] }
      if (path.includes("/api/medications")) return { ok: true, json: async () => [] }
      return { ok: true, json: async () => [] }
    }))
    await uploadExport()
    goToStep("Review and apply")
    expect(screen.getByRole("heading", { name: "Settings differences" })).toBeTruthy()
    expect(screen.getByText("Default timezone: this instance has Australia/Adelaide and the export has Europe/London. This instance is kept.")).toBeTruthy()
    expect(screen.getByText(/Secrets in the export will not be applied/)).toBeTruthy()
    expect(screen.getByText(/Per-user settings will not be restored/)).toBeTruthy()

    fireEvent.click(screen.getByRole("checkbox", { name: "I have reviewed this preview" }))
    fireEvent.click(screen.getByRole("button", { name: "Apply restore" }))
    expect(await screen.findByRole("heading", { name: "Restore complete" })).toBeTruthy()
    expect(screen.getByText("Created 2 favourites.")).toBeTruthy()
    expect(screen.getByText("Did not restore 1 favourite (account not restored).")).toBeTruthy()
    expect(screen.getByText("Applied Measurement system as imperial.")).toBeTruthy()
    expect(screen.getByText("1 secret setting was not applied.")).toBeTruthy()
    expect(screen.getByText("Per-user settings were not restored.")).toBeTruthy()
  })

  it("moves between mapping choices with the arrow keys", async () => {
    stagePreview()
    await uploadExport()
    const group = screen.getByRole("radiogroup", { name: "What to do with Alex" })
    group.focus()
    fireEvent.keyDown(group, { key: "ArrowRight" })
    expect(within(group).getByRole("radio", { name: "Map to existing" }).getAttribute("aria-checked")).toBe("true")
    fireEvent.keyDown(group, { key: "ArrowRight" })
    expect(within(group).getByRole("radio", { name: "Skip" }).getAttribute("aria-checked")).toBe("true")
  })

  it("announces an upload problem and focuses the file field", async () => {
    const heard: string[] = []
    subscribeToAnnouncements(message => { heard.push(message) })
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).endsWith("/api/restore/upload")) {
        return { ok: false, status: 400, json: async () => ({ error: "This file is not a FamilyChart export" }) }
      }
      return { ok: true, json: async () => [] }
    }))
    render(<AdminExportPage />)
    const input = document.querySelector("input[type=file]") as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(["nope"], "notes.txt", { type: "text/plain" })] } })
    expect(await screen.findByText("This file is not a FamilyChart export")).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(input))
    expect(heard).toContain("1 problem to fix. First: Export file.")
  })
})

describe("Restore steps and tabs", () => {
  it("lists skipped catalogue entries once on the review step", async () => {
    const plan = {
      ...PREVIEW,
      warnings: ["Total Chol.", "T.Prot."].map(name => ({ kind: "unknown_catalogue", catalogue: "test_metric", name })),
    }
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
      if (path.endsWith("/api/restore/upload")) return { ok: true, json: async () => ({ id: "staged1" }) }
      if (path === "/api/restore/staged1" && init?.method !== "POST") return { ok: true, json: async () => plan }
      return { ok: true, json: async () => [] }
    }))
    await uploadExport()
    expect(screen.queryByText(/does not have/)).toBeNull()
    goToStep("Review and apply")
    expect(screen.getAllByText(/does not have 2 entries/)).toHaveLength(1)
    expect(screen.getByText(/Total Chol\. and T\.Prot\./)).toBeTruthy()
  })

  it("offers Export and Restore as separate tabs", async () => {
    tabParam = "export"
    render(<AdminExportPage />)
    expect(screen.getByRole("tab", { name: "Export" }).getAttribute("aria-selected")).toBe("true")
    expect(screen.getByRole("tab", { name: "Restore" }).getAttribute("aria-selected")).toBe("false")
    expect(screen.queryByRole("button", { name: "Choose file" })).toBeNull()
    expect(screen.getByRole("button", { name: "Download household export" })).toBeTruthy()
  })
})

describe("Person Sign-in", () => {
  it("shows the optional Sign-in field, announces an invalid email, and names restored settings", async () => {
    const heard: string[] = []
    subscribeToAnnouncements(message => { heard.push(message) })
    const plan = {
      ...PREVIEW,
      scope: "person" as const,
      format_version: 2,
      persons: [
        { bundle_id: 1, name: "Alex", date_of_birth: "2015-04-02", suggested_action: "new" as const, target_id: null },
      ],
      user_settings: { lines: [] },
    }
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
      if (path.endsWith("/api/restore/upload")) return { ok: true, json: async () => ({ id: "staged1" }) }
      if (path === "/api/restore/staged1" && init?.method !== "POST") return { ok: true, json: async () => plan }
      if (path === "/api/restore/staged1/apply") {
        const body = JSON.parse(String(init?.body)) as { person_sign_ins: { email: string; role: string }[] }
        if (body.person_sign_ins[0]?.email === "taken@example.com") {
          return {
            ok: false,
            status: 400,
            json: async () => ({
              error: "This account already has a Personal-link to someone else.",
              sign_in_bundle_id: 1,
            }),
          }
        }
        return {
          ok: true,
          json: async () => ({
            ...plan,
            user_settings: { lines: ["personal settings not carried: no sign-in given"] },
            persons: [{ bundle_id: 1, name: "Alex", date_of_birth: "2015-04-02", suggested_action: "new", target_id: null }],
            created: { persons: 1 },
          }),
        }
      }
      if (path.includes("/api/people")) return { ok: true, json: async () => [] }
      if (path.includes("/api/medications")) return { ok: true, json: async () => [] }
      return { ok: true, json: async () => [] }
    }))
    render(
      <>
        <LiveRegion />
        <AdminExportPage />
      </>,
    )
    const input = document.querySelector("input[type=file]") as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(["zip"], "alex.zip", { type: "application/zip" })] } })
    await screen.findByRole("radiogroup", { name: "What to do with Alex" })
    const email = screen.getByLabelText("Sign-in for this Person (optional)")
    expect(screen.getByRole("combobox", { name: "Household Role" })).toBeTruthy()
    expect((screen.getByRole("combobox", { name: "Household Role" }) as HTMLSelectElement).value).toBe("none")

    fireEvent.change(email, { target: { value: "not-an-email" } })
    goToStep("Review and apply")
    fireEvent.click(screen.getByRole("checkbox", { name: "I have reviewed this preview" }))
    fireEvent.click(screen.getByRole("button", { name: "Apply restore" }))
    expect(await screen.findByText("Enter a valid email address.")).toBeTruthy()
    await waitFor(() => expect(heard.some(message => message.startsWith("1 problem to fix."))).toBe(true))

    fireEvent.change(screen.getByLabelText("Sign-in for this Person (optional)"), { target: { value: "" } })
    goToStep("Review and apply")
    fireEvent.click(screen.getByRole("checkbox", { name: "I have reviewed this preview" }))
    fireEvent.click(screen.getByRole("button", { name: "Apply restore" }))
    expect(await screen.findByRole("heading", { name: "Restore complete" })).toBeTruthy()
    expect(screen.getByText("personal settings not carried: no sign-in given")).toBeTruthy()
  })
})

describe("Protected restore", () => {
  it("asks for the passphrase, announces a wrong one, and does not upload again to retry", async () => {
    const heard: string[] = []
    subscribeToAnnouncements(message => { heard.push(message) })
    let uploads = 0
    let unlocks = 0
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
      if (path.endsWith("/api/restore/upload")) {
        uploads += 1
        return { ok: true, json: async () => ({ id: "staged1", protected: true }) }
      }
      if (path.endsWith("/api/restore/staged1/passphrase") && init?.method === "POST") {
        unlocks += 1
        const body = JSON.parse(String(init.body)) as { passphrase: string }
        if (body.passphrase !== "23456ABCDEFGHJKLMNPQ") {
          return { ok: false, status: 400, json: async () => ({ error: "That passphrase doesn't open this file" }) }
        }
        return { ok: true, json: async () => ({ id: "staged1" }) }
      }
      if (path === "/api/restore/staged1") {
        return {
          ok: true,
          json: async () => ({
            persons: [{ bundle_id: 1, name: "Alex", date_of_birth: "2015-04-02", suggested_action: "new", target_id: null }],
            medications: [],
            differences: [],
            warnings: [],
            counts: { new: 1, duplicate: 0, differing: 0, skipped: 0 },
            created: {},
            duplicates: {},
            skipped_unknown: [],
            mapped: { persons: 0, medications: 0 },
            accounts: "not restored",
            favourites: "not restored",
            settings: "not restored",
          }),
        }
      }
      if (path.includes("/api/people")) return { ok: true, json: async () => [] }
      if (path.includes("/api/medications")) return { ok: true, json: async () => [] }
      return { ok: true, json: async () => [] }
    }))
    render(<AdminExportPage />)
    const input = document.querySelector("input[type=file]") as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(["zip"], "alex.zip", { type: "application/zip" })] } })
    const field = await screen.findByRole("textbox", { name: "Passphrase" })
    fireEvent.change(field, { target: { value: "WRONGPASSPHRASEXXXX" } })
    fireEvent.click(screen.getByRole("button", { name: "Open export" }))
    expect(await screen.findByText("That passphrase doesn't open this file")).toBeTruthy()
    await waitFor(() => expect(heard).toContain("That passphrase doesn't open this file"))
    expect(uploads).toBe(1)
    fireEvent.change(field, { target: { value: "23456ABCDEFGHJKLMNPQ" } })
    fireEvent.click(screen.getByRole("button", { name: "Open export" }))
    expect(await screen.findByRole("radiogroup", { name: "What to do with Alex" })).toBeTruthy()
    expect(uploads).toBe(1)
    expect(unlocks).toBe(2)
  })
})
