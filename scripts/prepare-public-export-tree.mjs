#!/usr/bin/env node
/**
 * Removes paths classified `excluded` or `excluded-scanned` in
 * public-export-manifest.json from the working tree. Run in the
 * public-export sync workflow after the classification and leak gates,
 * immediately before the orphan commit that is pushed to
 * WheelieLabs/familychart — otherwise `git add -A` would publish excluded
 * directories (docs-internal today). See
 * docs/adr/0013-public-export-scope-manifest.md.
 *
 * Run manually:  node scripts/prepare-public-export-tree.mjs
 */

import { existsSync, readFileSync, rmSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = process.env.FC_REPO_ROOT || resolve(__dirname, "..")

const manifestPath = resolve(root, "public-export-manifest.json")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))

const excluded = Object.entries(manifest.paths)
  .filter(
    ([, value]) =>
      value &&
      typeof value === "object" &&
      (value.status === "excluded" || value.status === "excluded-scanned"),
  )
  .map(([path]) => path)

const stripped = []
for (const rel of excluded) {
  if (rel.includes("..") || rel.startsWith("/") || rel.includes("\\")) {
    console.error(`prepare-public-export-tree: refusing unsafe manifest path ${rel}`)
    process.exit(1)
  }
  const full = resolve(root, rel)
  if (!full.startsWith(root)) {
    console.error(`prepare-public-export-tree: path escaped repo root: ${rel}`)
    process.exit(1)
  }
  if (!existsSync(full)) continue
  rmSync(full, { recursive: true, force: true })
  stripped.push(rel)
}

if (stripped.length === 0) {
  console.log("prepare-public-export-tree: no excluded paths present in the working tree.")
} else {
  console.log(`prepare-public-export-tree: stripped ${stripped.length} excluded path(s):`)
  for (const p of stripped) console.log(`  - ${p}`)
}
