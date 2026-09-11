import { mkdtempSync, mkdirSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join, resolve } from "path"
import { execFileSync } from "child_process"
import { describe, expect, it } from "vitest"

const scriptPath = resolve(process.cwd(), "scripts/check-public-export-manifest.mjs")

function makeRepo(paths: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "fc-export-manifest-"))
  execFileSync("git", ["init", "-q"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir })
  for (const p of paths) {
    const full = join(dir, p)
    mkdirSync(resolve(full, ".."), { recursive: true })
    writeFileSync(full, "x")
  }
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

describe("check-public-export-manifest.mjs", () => {
  it("passes when every top-level path is classified", () => {
    const dir = makeRepo(["README.md", "app/page.ts"])
    writeFileSync(
      join(dir, "public-export-manifest.json"),
      JSON.stringify({ paths: { "README.md": "public", app: "public" } }),
    )
    const output = runCheck(dir)
    expect(output).toContain("check passed")
  })

  it("fails loudly on an unclassified top-level path", () => {
    const dir = makeRepo(["README.md", "new-internal-tool/index.ts"])
    writeFileSync(
      join(dir, "public-export-manifest.json"),
      JSON.stringify({ paths: { "README.md": "public" } }),
    )
    expect(() => runCheck(dir)).toThrowError(/Command failed/)
    try {
      runCheck(dir)
    } catch (err) {
      const stderr = (err as { stderr: Buffer }).stderr.toString()
      expect(stderr).toContain("new-internal-tool")
    }
  })

  it("treats an excluded, labelled entry as classified (not a failure)", () => {
    const dir = makeRepo(["README.md", "internal-secrets/config.ts"])
    writeFileSync(
      join(dir, "public-export-manifest.json"),
      JSON.stringify({
        paths: {
          "README.md": "public",
          "internal-secrets": { status: "excluded", label: "internal/proprietary — not exported" },
        },
      }),
    )
    const output = runCheck(dir)
    expect(output).toContain("check passed")
  })
})
