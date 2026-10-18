import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("ADR index", () => {
  it("lists database encryption ADR as implemented", () => {
    const readme = readFileSync(join(process.cwd(), "docs/adr/README.md"), "utf8")
    const row = readme.split("\n").find(line => line.includes("0003-database-encryption-modes"))
    expect(row).toBeDefined()
    expect(row).not.toMatch(/not yet implemented/)
  })

  it("does not track wave planning for shipped ADR-0003 consequences", () => {
    const adr = readFileSync(join(process.cwd(), "docs/adr/0003-database-encryption-modes.md"), "utf8")
    expect(adr).not.toMatch(/wave 7 \/ Project 1/)
  })
})
