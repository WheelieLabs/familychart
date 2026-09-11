import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join, resolve } from "path"
import { execFileSync } from "child_process"
import { describe, expect, it } from "vitest"

const scriptPath = resolve(process.cwd(), "scripts/prepare-public-export-tree.mjs")

function makeTree(): string {
  const dir = mkdtempSync(join(tmpdir(), "fc-export-prepare-"))
  mkdirSync(join(dir, "docs-internal"), { recursive: true })
  writeFileSync(join(dir, "docs-internal", "secret.md"), "internal")
  writeFileSync(join(dir, "README.md"), "public")
  writeFileSync(join(dir, "release-message.txt"), "FamilyChart v1.1.0: adds reminders")
  writeFileSync(
    join(dir, "public-export-manifest.json"),
    JSON.stringify({
      paths: {
        "README.md": "public",
        "docs-internal": { status: "excluded", label: "internal/proprietary — not exported" },
        "release-message.txt": { status: "excluded-scanned", label: "public commit message" },
      },
    }),
  )
  return dir
}

function runPrepare(dir: string) {
  return execFileSync(process.execPath, [scriptPath], {
    cwd: dir,
    env: { ...process.env, FC_REPO_ROOT: dir },
    stdio: "pipe",
    encoding: "utf8",
  })
}

describe("prepare-public-export-tree.mjs", () => {
  it("removes excluded and excluded-scanned paths and leaves public paths", () => {
    const dir = makeTree()
    const output = runPrepare(dir)
    expect(output).toContain("docs-internal")
    expect(output).toContain("release-message.txt")
    expect(existsSync(join(dir, "docs-internal"))).toBe(false)
    expect(existsSync(join(dir, "release-message.txt"))).toBe(false)
    expect(existsSync(join(dir, "README.md"))).toBe(true)
  })

  it("is a no-op when excluded paths are already absent", () => {
    const dir = makeTree()
    execFileSync("rm", ["-rf", join(dir, "docs-internal"), join(dir, "release-message.txt")])
    const output = runPrepare(dir)
    expect(output).toContain("no excluded paths present")
    expect(existsSync(join(dir, "README.md"))).toBe(true)
  })
})
