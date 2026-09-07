// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it } from "vitest"
import { getEncryptionMode } from "@/lib/encryption/mode"

describe("encryption mode", () => {
  const prev = process.env.FC_ENCRYPTION_MODE

  afterEach(() => {
    if (prev === undefined) delete process.env.FC_ENCRYPTION_MODE
    else process.env.FC_ENCRYPTION_MODE = prev
  })

  it("defaults to none", () => {
    delete process.env.FC_ENCRYPTION_MODE
    expect(getEncryptionMode()).toBe("none")
  })

  it("rejects invalid mode", () => {
    process.env.FC_ENCRYPTION_MODE = "bogus"
    expect(() => getEncryptionMode()).toThrow(/Invalid FC_ENCRYPTION_MODE/)
  })
})
