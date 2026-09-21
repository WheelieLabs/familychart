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

/**
 * CHANGELOG.md tracks normal release tags only — no release-candidate churn,
 * no public-export mirror tags. A version's history is still fully in git
 * (`git log -- CHANGELOG.md` / `git tag`); this just keeps the maintainer
 * log to one entry per real release, matching the existing "1.0.0 folds in
 * the rc.1-31 series" convention already used for the rc.* series before it.
 */
function isExcludedFromChangelog(version) {
  return /-rc\.\d+$/.test(version) || version.startsWith("public/")
}

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
    // A prior --write run appends HISTORICAL_NOTES ("## Historical notes",
    // no "[") after the last version block with no blank-line boundary the
    // split regex looks for, so it rides along inside that block's text.
    // Strip it back off here — otherwise every re-run both keeps this old
    // copy embedded in the preserved block AND appends a fresh one, and the
    // footer duplicates itself further on every subsequent run.
    const trimmed = part.replace(/\n+## Historical notes\n[\s\S]*$/, "").trimEnd()
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

/**
 * Strips issue/PR references (e.g. parenthesized or bare "hash-number")
 * from a raw git tag subject before it lands in CHANGELOG.md, which is a
 * public-classified path — check-public-export-leaks.mjs treats any
 * "hash followed by digits" as a leaked private-tracker reference and fails
 * the gate on it (as this comment would too, spelled out literally — hence
 * the paraphrase). Mirrors that script's own ISSUE_REF pattern so nothing
 * it would flag survives into the file.
 */
function stripIssueRefs(text) {
  return text
    .replace(/\s*\((?:[a-zA-Z][\w.-]{1,39})?#\d{1,5}\)/g, "")
    .replace(/(?:\b[a-zA-Z][\w.-]{1,39})?#\d{1,5}\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
}

function cleanSubject(subject) {
  return stripIssueRefs(
    subject.replace(/\s*[—–-]\s*v?\d+\.\d+(\.\d+)?(-p\d+)?\s*$/i, ""),
  ).trim()
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

/**
 * [major, minor, patch, releaseRank, prereleaseNum]. releaseRank orders
 * "-rc.N" (0, pre-release) below the plain release (1) below "-pN" (2, a
 * post-release patch build) for the same major.minor.patch — verified
 * against the existing curated 0.37.6 / 0.37.6-p1 ordering in this file.
 * Strips a "public/v" prefix so the public-export mirror's tags interleave
 * with the matching version instead of falling through as unparseable.
 */
function parseVersion(v) {
  const stripped = v.replace(/^public\/v/, "")
  const m = stripped.match(/^(\d+)\.(\d+)\.(\d+)(?:-(rc)\.(\d+)|-p(\d+))?$/)
  if (!m) return null
  const [, major, minor, patch, isRc, rcNum, pNum] = m
  const releaseRank = isRc ? 0 : pNum !== undefined ? 2 : 1
  const prereleaseNum = isRc ? Number(rcNum) : pNum !== undefined ? Number(pNum) : 0
  return [Number(major), Number(minor), Number(patch), releaseRank, prereleaseNum]
}

function compareVersions(a, b) {
  // "Unreleased" isn't a version at all — always sorts first (newest).
  if (a === "Unreleased" || b === "Unreleased") {
    if (a === b) return 0
    return a === "Unreleased" ? -1 : 1
  }
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  // An unparseable version has no ordering information — sort it after
  // every version that does, rather than silently defaulting to [0,0,0,0,0]
  // (which sorted entire families of tags, like every "-rc.N", below
  // real releases like 0.8.1 — the bug this comment replaces).
  if (!pa || !pb) {
    if (!pa && !pb) return 0
    return pa ? -1 : 1
  }
  for (let i = 0; i < 5; i++) {
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
  ].filter((v) => !OMITTED_VERSIONS.has(v) && !isExcludedFromChangelog(v))

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
