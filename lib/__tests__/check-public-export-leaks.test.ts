import { mkdtempSync, mkdirSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join, resolve } from "path"
import { execFileSync } from "child_process"
import { describe, expect, it } from "vitest"

const scriptPath = resolve(process.cwd(), "scripts/check-public-export-leaks.mjs")

// Built by concatenation, not written as literal "#42" / "familychart-dev#301",
// so this test file's own source text doesn't trip check-public-export-leaks.mjs
// when it scans lib/__tests__ as a public path.
const sampleIssueRef = ["#", "42"].join("")
const sampleCrossRepoRef = ["familychart-dev", "#", "301"].join("")

function makeRepo(files: Record<string, string>, manifestPaths: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "fc-export-leaks-"))
  execFileSync("git", ["init", "-q"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir })
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path)
    mkdirSync(resolve(full, ".."), { recursive: true })
    writeFileSync(full, content)
  }
  writeFileSync(join(dir, "public-export-manifest.json"), JSON.stringify({ paths: manifestPaths }))
  execFileSync("git", ["add", "-A"], { cwd: dir })
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir })
  return dir
}

function runCheck(dir: string) {
  return execFileSync(process.execPath, [scriptPath], {
    cwd: dir,
    env: { ...process.env, FC_REPO_ROOT: dir },
    stdio: "pipe",
    encoding: "utf8",
  })
}

describe("check-public-export-leaks.mjs", () => {
  it("passes when public files contain no issue references", () => {
    const dir = makeRepo({ "README.md": "no refs here" }, { "README.md": "public" })
    const output = runCheck(dir)
    expect(output).toContain("check passed")
  })

  it("fails on a bare issue reference in a public file", () => {
    const dir = makeRepo({ "README.md": `fixes ${sampleIssueRef}` }, { "README.md": "public" })
    expect(() => runCheck(dir)).toThrowError(/Command failed/)
  })

  it("scans excluded-scanned paths even though they are stripped from the export tree", () => {
    const dir = makeRepo(
      { "release-message.txt": `see ${sampleCrossRepoRef}` },
      { "release-message.txt": { status: "excluded-scanned", label: "public commit message" } },
    )
    expect(() => runCheck(dir)).toThrowError(/Command failed/)
    try {
      runCheck(dir)
    } catch (err) {
      const stderr = (err as { stderr: Buffer }).stderr.toString()
      expect(stderr).toContain("release-message.txt")
    }
  })

  it("does not scan plain excluded paths", () => {
    const dir = makeRepo(
      { "docs-internal/notes.md": `references ${sampleCrossRepoRef}` },
      { "docs-internal": { status: "excluded", label: "internal/proprietary — not exported" } },
    )
    const output = runCheck(dir)
    expect(output).toContain("check passed")
  })
})
