#!/usr/bin/env node
/**
 * Add SPDX headers to first-party TypeScript sources.
 * Scope: app/, components/, lib/ (excluding __tests__).
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")
const SPDX = "// SPDX-License-Identifier: AGPL-3.0-only"

const roots = [
  path.join(root, "app"),
  path.join(root, "components"),
  path.join(root, "lib"),
]

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue
      walk(full, files)
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full)
    }
  }
  return files
}

function addHeader(file) {
  const original = fs.readFileSync(file, "utf8")
  if (original.includes("SPDX-License-Identifier")) return false

  const lines = original.split("\n")
  const first = lines[0] ?? ""
  const second = lines[1] ?? ""

  if (/^["']use (client|server)["']/.test(first)) {
    const updated = [SPDX, "", ...lines].join("\n")
    fs.writeFileSync(file, updated.endsWith("\n") ? updated : updated + "\n", "utf8")
    return true
  }

  if (/^["']use (client|server)["']/.test(second) && first.startsWith("//")) {
    // already has a comment line before directive — replace first line
    lines[0] = SPDX
    const updated = lines.join("\n")
    fs.writeFileSync(file, updated.endsWith("\n") ? updated : updated + "\n", "utf8")
    return true
  }

  const updated = SPDX + "\n\n" + original.replace(/^\n+/, "")
  fs.writeFileSync(file, updated.endsWith("\n") ? updated : updated + "\n", "utf8")
  return true
}

let changed = 0
for (const dir of roots) {
  if (!fs.existsSync(dir)) continue
  for (const file of walk(dir)) {
    if (addHeader(file)) changed++
  }
}

console.log(`SPDX headers added/updated in ${changed} files`)
