// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest"
import { accountUidFromRow, formatLocalAccountUid, parseLocalAccountUid } from "@/lib/account/account-uid"

describe("formatLocalAccountUid", () => {
  it("returns the canonical local account uid", () => {
    expect(formatLocalAccountUid(7)).toBe("local:7")
  })
})

describe("parseLocalAccountUid", () => {
  it("round-trips a formatted local uid", () => {
    expect(parseLocalAccountUid(formatLocalAccountUid(42))).toBe(42)
  })

  it("returns null for an Entra oid", () => {
    expect(parseLocalAccountUid("00000000-0000-0000-0000-000000000000")).toBeNull()
  })

  it("returns null for null/undefined/empty input", () => {
    expect(parseLocalAccountUid(null)).toBeNull()
    expect(parseLocalAccountUid(undefined)).toBeNull()
    expect(parseLocalAccountUid("")).toBeNull()
  })

  it("returns null for a non-numeric local suffix", () => {
    expect(parseLocalAccountUid("local:abc")).toBeNull()
  })
})

describe("accountUidFromRow", () => {
  it("formats a local account row", () => {
    expect(accountUidFromRow({ auth_method: "local", id: 3, external_id: null })).toBe("local:3")
  })

  it("uses the trimmed external_id for an Entra account row", () => {
    expect(accountUidFromRow({ auth_method: "entra", id: 3, external_id: " oid-123 " })).toBe("oid-123")
  })

  it("returns null when an Entra row has no external_id", () => {
    expect(accountUidFromRow({ auth_method: "entra", id: 3, external_id: null })).toBeNull()
  })
})
