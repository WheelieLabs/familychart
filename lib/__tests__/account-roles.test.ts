// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest"
import { VALID_ROLES } from "@/lib/account/account-roles"
import { accountListCopy } from "@/lib/account/account-role-labels"

describe("VALID_ROLES", () => {
  it("accepts none alongside the household ladder", () => {
    expect(VALID_ROLES.has("none")).toBe(true)
    expect(VALID_ROLES.has("admin")).toBe(true)
    expect(VALID_ROLES.has("manage")).toBe(true)
    expect(VALID_ROLES.has("write")).toBe(true)
    expect(VALID_ROLES.has("read")).toBe(true)
  })
})

describe("Accounts list role and reports copy", () => {
  it("shows Role None and cleared Household Reports on a None row", () => {
    expect(accountListCopy({ auth_method: "local", role: "none", can_report: 0 })).toEqual({
      role: "Role: None",
      reports: "Cannot access reports",
    })
  })

  it("shows Household Reports when the flag is set on a household Role", () => {
    expect(accountListCopy({ auth_method: "local", role: "write", can_report: 1 }).reports)
      .toBe("Can access reports")
  })
})
