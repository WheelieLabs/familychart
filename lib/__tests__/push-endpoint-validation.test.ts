import { describe, expect, it } from "vitest"
import type { LookupAddress } from "dns"
import {
  createPushHttpsAgent,
  validatePushEndpoint,
} from "@/lib/push/push-endpoint-validation"

describe("validatePushEndpoint", () => {
  it("rejects non-https endpoints", async () => {
    expect(await validatePushEndpoint("http://fcm.googleapis.com/fcm/send/x")).toMatch(/HTTPS/)
  })

  it("rejects localhost", async () => {
    expect(await validatePushEndpoint("https://localhost/push")).toMatch(/allowed push service/)
  })

  it("accepts known Google push host", async () => {
    expect(await validatePushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBeNull()
  })
})

describe("createPushHttpsAgent lookup", () => {
  // Node's Happy Eyeballs (autoSelectFamily, default-on in Node >= 20) calls
  // the agent's lookup with `all: true` and expects an array of
  // { address, family } back. Returning a single address there produces
  // "Invalid IP address: undefined" and every push send fails to connect.
  function agentLookup(
    hostname: string,
    options: { all?: boolean },
  ): Promise<unknown> {
    const lookup = (createPushHttpsAgent() as unknown as {
      options: { lookup: (...a: unknown[]) => void }
    }).options.lookup
    return new Promise((resolve, reject) => {
      lookup(hostname, options, (err: Error | null, ...rest: unknown[]) =>
        err ? reject(err) : resolve(rest),
      )
    })
  }

  it("returns an array of { address, family } when called with all: true", async () => {
    // IP literal — resolved synchronously by dns.lookup, no network needed.
    const [result] = (await agentLookup("93.184.216.34", { all: true })) as [
      LookupAddress[],
    ]
    expect(Array.isArray(result)).toBe(true)
    expect(result[0]).toMatchObject({ address: "93.184.216.34", family: 4 })
  })

  it("returns a single address + family when called without all", async () => {
    const [address, family] = (await agentLookup("93.184.216.34", {})) as [
      string,
      number,
    ]
    expect(address).toBe("93.184.216.34")
    expect(family).toBe(4)
  })
})
