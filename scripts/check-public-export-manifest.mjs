#!/usr/bin/env node
/**
 * Fails loudly if any top-level, git-tracked path in the repo isn't classified
 * in public-export-manifest.json. Run as a blocking step in the public-main
 * tag-triggered sync workflow before mirroring the tree to the public repo
 * (WheelieLabs/familychart) — see docs/adr/0013-public-export-scope-manifest.md.
 *
 * Run manually:  node scripts/check-public-export-manifest.mjs
 */

import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { execFileSync } from "child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = process.env.FC_REPO_ROOT || resolve(__dirname, "..")

const manifestPath = resolve(root, "public-export-manifest.json")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
const classified = new Set(Object.keys(manifest.paths))

const tracked = execFileSync("git", ["ls-tree", "--name-only", "HEAD"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)

const unclassified = tracked.filter((path) => !classified.has(path))

if (unclassified.length > 0) {
  console.error("public-export-manifest check FAILED")
  console.error("The following top-level paths are not classified in public-export-manifest.json:")
  for (const path of unclassified) console.error(`  - ${path}`)
  console.error("\nAdd each path to public-export-manifest.json as \"public\", or as")
  console.error('{ "status": "excluded", "label": "..." } (or "excluded-scanned" if its content')
  console.error("still reaches the public repo some other way) before this sync can proceed.")
  process.exit(1)
}

console.log(`public-export-manifest check passed — ${tracked.length} top-level paths classified.`)
