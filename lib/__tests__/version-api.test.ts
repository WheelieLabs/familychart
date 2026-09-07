import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/version", () => ({ APP_VERSION: "0.42.0" }))

describe("/api/version", () => {
  const ORIGINAL_ENV = { ...process.env }

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it("returns the server APP_VERSION with no-store cache", async () => {
    const { GET } = await import("@/app/api/version/route")
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ version: "0.42.0" })
    expect(res.headers.get("Cache-Control")).toBe("no-store")
  })

  it("omits demoVersion when not in demo mode", async () => {
    process.env.DEMO_VERSION = "1.1.0"
    const { GET } = await import("@/app/api/version/route")
    const res = await GET()
    expect(await res.json()).toEqual({ version: "0.42.0" })
  })

  it("includes demoVersion when demo mode is active", async () => {
    process.env.DEMO_MODE = "true"
    process.env.FC_PLATFORM_PROFILE = "demo"
    process.env.DEMO_VERSION = "1.1.0"
    const { GET } = await import("@/app/api/version/route")
    const res = await GET()
    expect(await res.json()).toEqual({ version: "0.42.0", demoVersion: "1.1.0" })
  })
})
