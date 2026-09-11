#!/usr/bin/env node
/**
 * Backfill CHANGELOG.md with skeleton entries from git tags for versions
 * missing curated notes. Preserves existing curated blocks exactly.
 *
 * Usage: node scripts/backfill-changelog-from-tags.mjs [--write]
 *   Without --write, prints merged CHANGELOG to stdout.
 */

import { readFileSync, writeFileSync } from "fs"
import { execSync } from "child_process"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")
const changelogPath = resolve(root, "CHANGELOG.md")

/** Versions intentionally never tagged — omit from CHANGELOG. */
const OMITTED_VERSIONS = new Set([
  "0.29.3",
  "0.29.4",
  "0.29.5",
  "0.29.6",
  "0.29.7",
  "0.29.8",
  "0.29.9",
])

/** Curated entries for recent releases (not skeleton). */
const CURATED_OVERRIDES = {
  "0.40.0": `## [0.40.0] - 2026-06-26

Wave 1 — medication dosing-alert correctness.

### Fixed
- Recording a dose for a scheduled medication clears the scheduled/overdue dashboard alert again (restores proximity clearance removed in 0.37.8).
- Record Medication deep-link prefills the scheduled slot dosage (\`scheduledDosage\` in \`action_url\`).
- Record Medication API returns medications for personal-link users; search and deep-link prefill.
- Stop evaluating group-scoped frequency rules against sibling group members.
`,
  "0.40.4": `## [0.40.4] - 2026-07-02

Wave 2 — application security hardening (run 4).

### Security
- MFA second factor cannot be re-enrolled by a session-only attacker without password + existing TOTP.
- Push subscriptions pruned when a local user is deactivated or downgraded; cron re-checks person access before send.
- Client-controlled \`remind_after_hours\` clamped to medication min-interval and sensible bounds.
- \`/api/health\` no longer discloses server data-directory path.
`,
  "0.40.5": `## [0.40.5] - 2026-07-02

### Fixed
- Unwind cached Management > Medications redirect so the route no longer 404s when the browser cached the legacy 308.
`,
}

const HISTORICAL_NOTES = `
## Historical notes

- Versions **0.29.3** through **0.29.9** were never tagged and are intentionally omitted from this changelog.
- Skeleton entries for releases before **0.14.0** are one-line summaries derived from annotated git tag subjects; see git history for full detail.
`

function loadTags() {
  const raw = execSync(
    "git for-each-ref --sort=version:refname --format '%(refname:short)|%(creatordate:short)|%(contents:subject)' refs/tags",
    { encoding: "utf8", cwd: root },
  ).trim()

  return raw.split("\n").map((line) => {
    const [tag, date, ...rest] = line.split("|")
    const subject = rest.join("|")
    const version = tag.replace(/^v/, "")
    return { version, date, subject }
  })
}

function parseExistingChangelog(text) {
  const headerEnd = text.indexOf("## [")
  if (headerEnd === -1) {
    throw new Error("CHANGELOG.md: no version headers found")
  }
  const header = text.slice(0, headerEnd)

  const blocks = new Map()
  const parts = text.slice(headerEnd).split(/\n(?=## \[)/)
  for (const part of parts) {
    const trimmed = part.trimEnd()
    if (!trimmed.startsWith("## [")) continue
    const versionMatch = trimmed.match(/^## \[([^\]]+)\]/)
    if (!versionMatch) continue
    blocks.set(versionMatch[1], trimmed + "\n")
  }
  return { header, blocks }
}

function isBareVersionSubject(subject, version) {
  const trimmed = subject.trim()
  return (
    trimmed === version ||
    trimmed === `v${version}` ||
    /^v?\d+\.\d+(\.\d+)?(-p\d+)?$/.test(trimmed)
  )
}

function categorize(subject) {
  const s = subject.toLowerCase()
  if (s.startsWith("security") || /\bsecurity:/.test(s)) return "Security"
  if (s.startsWith("feat") || /\bfeat[(:]/.test(s)) return "Added"
  if (
    s.startsWith("fix") ||
    s.startsWith("hotfix") ||
    s.startsWith("bug") ||
    /\b(fix|hotfix|bug)[(:]/.test(s)
  ) {
    return "Fixed"
  }
  return "Changed"
}

function cleanSubject(subject) {
  return subject
    .replace(/\s*[—–-]\s*v?\d+\.\d+(\.\d+)?(-p\d+)?\s*$/i, "")
    .trim()
}

function skeletonBlock({ version, date, subject }) {
  let section
  let bullet

  if (isBareVersionSubject(subject, version)) {
    section = "Changed"
    bullet = `Release v${version} (early development; see git history).`
  } else {
    section = categorize(subject)
    bullet = cleanSubject(subject) || subject.trim()
  }

  return `## [${version}] - ${date}

### ${section}
- ${bullet}
`
}

function compareVersions(a, b) {
  const parse = (v) => {
    const m = v.match(/^(\d+)\.(\d+)\.(\d+)(?:-p(\d+))?$/)
    if (!m) return [0, 0, 0, 0]
    return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0)]
  }
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < 4; i++) {
    if (pa[i] !== pb[i]) return pb[i] - pa[i]
  }
  return 0
}

function buildMergedChangelog() {
  const existingText = readFileSync(changelogPath, "utf8")
  const { header, blocks: existingBlocks } = parseExistingChangelog(existingText)
  const tags = loadTags()

  const tagByVersion = new Map(tags.map((t) => [t.version, t]))
  const allVersions = [
    ...new Set([...tags.map((t) => t.version), ...existingBlocks.keys()]),
  ].filter((v) => !OMITTED_VERSIONS.has(v))

  allVersions.sort(compareVersions)

  const outputBlocks = []
  let skeletonCount = 0
  let curatedOverrideCount = 0
  let preservedCount = 0

  for (const version of allVersions) {
    if (existingBlocks.has(version)) {
      outputBlocks.push(existingBlocks.get(version))
      preservedCount++
    } else if (CURATED_OVERRIDES[version]) {
      outputBlocks.push(CURATED_OVERRIDES[version])
      curatedOverrideCount++
    } else if (tagByVersion.has(version)) {
      outputBlocks.push(skeletonBlock(tagByVersion.get(version)))
      skeletonCount++
    }
  }

  const merged =
    header.replace(/\s+$/, "") +
    "\n\n" +
    outputBlocks.join("\n") +
    HISTORICAL_NOTES

  return {
    merged,
    stats: {
      preservedCount,
      skeletonCount,
      curatedOverrideCount,
      totalVersions: outputBlocks.length,
      omitted: OMITTED_VERSIONS.size,
    },
  }
}

const write = process.argv.includes("--write")
const { merged, stats } = buildMergedChangelog()

if (write) {
  writeFileSync(changelogPath, merged)
  console.log("backfill-changelog: wrote CHANGELOG.md")
  console.log(
    `  preserved curated: ${stats.preservedCount}, skeleton added: ${stats.skeletonCount}, curated overrides: ${stats.curatedOverrideCount}, total versions: ${stats.totalVersions}`,
  )
} else {
  process.stdout.write(merged)
  console.error(
    `stats: preserved=${stats.preservedCount} skeleton=${stats.skeletonCount} overrides=${stats.curatedOverrideCount} total=${stats.totalVersions}`,
  )
}
