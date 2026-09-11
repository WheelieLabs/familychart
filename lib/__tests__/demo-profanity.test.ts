// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest"
import {
  fieldsContainLocalProfanity,
  fieldsContainProfanityViaApi,
  textContainsLocalProfanity,
} from "@/lib/demo/demo-profanity"
import { rejectDemoProfanity } from "@/lib/demo/demo-profanity-guard"
import { DEMO_PLATFORM_PROFILE } from "@/lib/demo/demo-mode"

describe("demo-profanity local blocklist", () => {
  it("matches severe terms on word boundaries", () => {
    expect(textContainsLocalProfanity("what the fuck")).toBe(true)
    expect(textContainsLocalProfanity("Ibuprofen 200mg")).toBe(false)
  })

  it("does not false-positive on clinical vocabulary substrings", () => {
    expect(textContainsLocalProfanity("assessment")).toBe(false)
    expect(textContainsLocalProfanity("classify")).toBe(false)
  })

  it("does not match mild profanity removed from local list", () => {
    expect(textContainsLocalProfanity("damn")).toBe(false)
    expect(textContainsLocalProfanity("hell")).toBe(false)
  })

  it("checks multiple fields locally", () => {
    expect(fieldsContainLocalProfanity(["fine", null, "shit"])).toBe(true)
    expect(fieldsContainLocalProfanity(["Paracetamol", "Taken with food"])).toBe(false)
  })
})

describe("fieldsContainProfanityViaApi", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns true when purgomalum responds true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "true",
      }),
    )
    expect(await fieldsContainProfanityViaApi(["some text"])).toBe(true)
  })

  it("fail-open when purgomalum errors", async () => {
    const { logger } = await import("@/lib/logger")
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {})
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")))
    expect(await fieldsContainProfanityViaApi(["some text"])).toBe(false)
    expect(warn).toHaveBeenCalledWith("[demo-profanity] purgomalum unavailable, fail-open")
  })

  it("fail-open when purgomalum returns non-OK", async () => {
    const { logger } = await import("@/lib/logger")
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {})
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, text: async () => "" }),
    )
    expect(await fieldsContainProfanityViaApi(["some text"])).toBe(false)
    expect(warn).toHaveBeenCalled()
  })

  it("batches fields into one request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "false",
    })
    vi.stubGlobal("fetch", fetchMock)
    await fieldsContainProfanityViaApi(["line one", "line two"])
    expect(fetchMock).toHaveBeenCalledOnce()
    const url = fetchMock.mock.calls[0]![0] as string
    expect(url).toContain(encodeURIComponent("line one\nline two"))
  })
})

describe("rejectDemoProfanity", () => {
  const originalDemo = process.env.DEMO_MODE
  const originalProfile = process.env.FC_PLATFORM_PROFILE

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalDemo === undefined) delete process.env.DEMO_MODE
    else process.env.DEMO_MODE = originalDemo
    if (originalProfile === undefined) delete process.env.FC_PLATFORM_PROFILE
    else process.env.FC_PLATFORM_PROFILE = originalProfile
  })

  it("is inert outside armed demo mode", async () => {
    delete process.env.DEMO_MODE
    delete process.env.FC_PLATFORM_PROFILE
    expect(await rejectDemoProfanity("fuck")).toBeNull()
  })

  it("returns 400 for local blocklist hit without calling API", async () => {
    process.env.DEMO_MODE = "true"
    process.env.FC_PLATFORM_PROFILE = DEMO_PLATFORM_PROFILE
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const res = await rejectDemoProfanity("fuck")
    expect(res?.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns 400 when purgomalum flags clean local text", async () => {
    process.env.DEMO_MODE = "true"
    process.env.FC_PLATFORM_PROFILE = DEMO_PLATFORM_PROFILE
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "true",
      }),
    )
    const res = await rejectDemoProfanity("mild text only")
    expect(res?.status).toBe(400)
  })
})
