#!/usr/bin/env node
/**
 * Parses WHATS_NEW.md and writes lib/changelog.generated.json.
 *
 * Each ## [version] - date section with bullet lines is surfaced in the
 * in-app What's New modal. Maintainer-facing release notes live in CHANGELOG.md.
 *
 * Output schema:
 *   { entries: Array<{ version: string; date: string; highlights: string[] }> }
 *
 * Run manually:  node scripts/build-changelog.mjs
 * Run at build:  npm run prebuild (wired into package.json)
 */

import { readFileSync, writeFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")

const srcPath =
  process.env.FC_WHATS_NEW_PATH ||
  process.env.FC_CHANGELOG_PATH ||
  resolve(root, "WHATS_NEW.md")
const src = readFileSync(srcPath, "utf8")
const lines = src.split("\n")

const entries = []
let current = null

for (const line of lines) {
  // ## [0.34.4] - 2026-06-08
  const headerMatch = line.match(/^## \[([^\]]+)\]\s*-\s*(\d{4}-\d{2}-\d{2})/)
  if (headerMatch) {
    if (current) entries.push(current)
    current = { version: headerMatch[1], date: headerMatch[2], highlights: [] }
    continue
  }

  if (!current) continue
  if (line.startsWith("### ")) continue
  if (line.startsWith("- ")) {
    current.highlights.push(line.slice(2).trim())
  }
}
if (current) entries.push(current)

const notable = entries
  .filter(e => e.highlights.length > 0)
  .map(({ version, date, highlights }) => ({ version, date, highlights }))

const out = JSON.stringify({ entries: notable }, null, 2) + "\n"
const outPath = process.env.FC_CHANGELOG_OUT || resolve(root, "lib/changelog.generated.json")
writeFileSync(outPath, out)
console.log(`build-changelog: wrote ${notable.length} notable entries to ${outPath}`)
