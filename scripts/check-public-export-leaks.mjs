#!/usr/bin/env node
/**
 * Fails loudly if any git-tracked path classified "public" or
 * "excluded-scanned" in public-export-manifest.json contains a bare
 * issue-number reference (e.g. "#" followed by digits) or a cross-repo
 * tracker reference (a repo name immediately followed by "#" and digits)
 * that would leak into the public export. "excluded-scanned" paths are
 * stripped from the tree by prepare-public-export-tree.mjs but still get
 * scanned here because their content reaches the public repo some other
 * way (e.g. embedded in the orphan commit message) — see
 * .github/public-release-message.txt's manifest entry. Content-level
 * companion to check-public-export-manifest.mjs, which only validates path
 * classification — see docs/adr/0013-public-export-scope-manifest.md.
 *
 * Excludes matches that look like quoted hex-color literals (`'#000'`,
 * `"#1a2b3c"`) or HTML numeric character references (`&#39;`, `&#160;`).
 *
 * Run manually:  node scripts/check-public-export-leaks.mjs
 */

import { readFileSync } from "fs"
import { resolve, dirname, extname } from "path"
import { fileURLToPath } from "url"
import { execFileSync } from "child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = process.env.FC_REPO_ROOT || resolve(__dirname, "..")

const manifestPath = resolve(root, "public-export-manifest.json")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
const scannedPaths = Object.entries(manifest.paths)
  .filter(
    ([, value]) =>
      value === "public" ||
      (value && typeof value === "object" && value.status === "excluded-scanned"),
  )
  .map(([path]) => path)

const tracked = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)

const publicFiles = tracked.filter((path) =>
  scannedPaths.some((p) => path === p || path.startsWith(`${p}/`)),
)

// Skip known-binary asset types — content is opaque, and readFileSync would
// otherwise choke turning them into text.
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".pdf", ".zip",
])

// A "#" followed by digits, optionally preceded by a bare repo name with no
// space (e.g. `repo-name#`). Deliberately digit-only after `#` so markdown
// anchors (`#some-heading`) never match.
const ISSUE_REF = /(?:\b[a-zA-Z][\w.-]{1,39})?#(\d{1,5})\b/g

const findings = []

for (const file of publicFiles) {
  if (BINARY_EXTENSIONS.has(extname(file))) continue

  let content
  try {
    content = readFileSync(resolve(root, file), "utf8")
  } catch {
    continue // gone from working tree, or genuinely binary despite extension
  }

  const lines = content.split("\n")
  lines.forEach((line, idx) => {
    for (const match of line.matchAll(ISSUE_REF)) {
      const start = match.index
      const end = start + match[0].length
      const before = line[start - 1]
      const after = line[end]
      const quoted = (before === "'" || before === '"') && (after === "'" || after === '"')
      if (quoted) continue // e.g. DEFAULT '#000' — hex-color literal, not an issue ref
      if (before === "&") continue // e.g. &#39; — HTML numeric character reference, not an issue ref

      findings.push({ file, line: idx + 1, text: match[0], context: line.trim() })
    }
  })
}

if (findings.length > 0) {
  console.error("public-export leak check FAILED")
  console.error("Issue-number or cross-repo tracker references found in public-classified paths:")
  for (const f of findings) {
    console.error(`  - ${f.file}:${f.line}: ${f.text}  (${f.context})`)
  }
  console.error(
    "\nDrop the issue number/link — keep any useful prose context. " +
      "See docs/adr/0013-public-export-scope-manifest.md.",
  )
  process.exit(1)
}

console.log(
  `public-export leak check passed — scanned ${publicFiles.length} files across ${scannedPaths.length} paths.`,
)
