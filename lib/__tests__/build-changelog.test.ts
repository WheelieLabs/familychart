import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join, resolve } from "path"
import { execFileSync } from "child_process"
import { describe, expect, it } from "vitest"

const scriptPath = resolve(process.cwd(), "scripts/build-changelog.mjs")

function runBuildChangelog(changelogBody: string) {
  const dir = mkdtempSync(join(tmpdir(), "fc-changelog-"))
  const changelogPath = join(dir, "CHANGELOG.md")
  const outDir = join(dir, "lib")
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, "changelog.generated.json")
  writeFileSync(changelogPath, changelogBody, "utf8")

  execFileSync(process.execPath, [scriptPath], {
    cwd: dir,
    env: {
      ...process.env,
      FC_CHANGELOG_PATH: changelogPath,
      FC_CHANGELOG_OUT: outPath,
    },
    stdio: "pipe",
  })

  return JSON.parse(readFileSync(outPath, "utf8")) as {
    entries: Array<{ version: string; date: string; highlights: string[] }>
  }
}

describe("build-changelog.mjs", () => {
  it("includes version sections with user-facing bullets from WHATS_NEW.md", () => {
    const whatsNew = `# What's New

## [0.37.0] - 2026-06-20

- New feature carers will notice

## [0.36.0] - 2026-06-10

## [0.34.4] - 2026-06-08

- Favourites
`

    const result = runBuildChangelog(whatsNew)
    expect(result.entries).toEqual([
      { version: "0.37.0", date: "2026-06-20", highlights: ["New feature carers will notice"] },
      { version: "0.34.4", date: "2026-06-08", highlights: ["Favourites"] },
    ])
  })
})
