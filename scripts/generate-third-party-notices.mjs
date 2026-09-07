#!/usr/bin/env node
/**
 * Regenerate THIRD-PARTY-NOTICES.md from package-lock.json production closure.
 * Usage: node scripts/generate-third-party-notices.mjs
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")
const lockPath = path.join(root, "package-lock.json")
const outPath = path.join(root, "THIRD-PARTY-NOTICES.md")

const LICENSE_CANDIDATES = [
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "LICENCE",
  "LICENCE.md",
  "LICENCE.txt",
  "License",
  "COPYING",
]

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

function packageNameFromPath(pkgPath) {
  const idx = pkgPath.lastIndexOf("node_modules/")
  return idx === -1 ? pkgPath : pkgPath.slice(idx + "node_modules/".length)
}

/** Lock path may be nested while npm hoists to top-level node_modules/<name>. */
function resolvePackageDir(pkgPath, name) {
  const lockDir = path.join(root, pkgPath)
  if (fs.existsSync(lockDir)) return lockDir
  const hoisted = path.join(root, "node_modules", ...name.split("/"))
  if (fs.existsSync(hoisted)) return hoisted
  return lockDir
}

/** Platform-stable licence text: LF newlines, no trailing spaces per line. */
function normalizeLicenseText(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
}

function readLicenseText(pkgDir) {
  for (const candidate of LICENSE_CANDIDATES) {
    const full = path.join(pkgDir, candidate)
    if (fs.existsSync(full)) {
      return { file: candidate, text: normalizeLicenseText(fs.readFileSync(full, "utf8")).trim() }
    }
  }
  return null
}

function formatLicenseId(info, pkgJson) {
  if (typeof info.license === "string" && info.license) return info.license
  if (pkgJson?.license) {
    return typeof pkgJson.license === "string"
      ? pkgJson.license
      : pkgJson.license.type || "UNKNOWN"
  }
  if (Array.isArray(pkgJson?.licenses) && pkgJson.licenses.length > 0) {
    return pkgJson.licenses.map((l) => l.type || l).join(" OR ")
  }
  return "UNKNOWN"
}

function preferRow(existing, row) {
  if (!existing) return row
  // Prefer non-optional (platform-optional installs vary across CI hosts).
  if (existing.optional && !row.optional) return row
  if (!existing.optional && row.optional) return existing
  if (!existing.licenseFile && row.licenseFile) return row
  return existing
}

function collectProductionPackages(lock) {
  const packages = lock.packages || {}
  const rows = []

  for (const [pkgPath, info] of Object.entries(packages)) {
    if (!pkgPath || info.dev) continue
    const name = packageNameFromPath(pkgPath)
    const optional = !!info.optional
    // Optional platform packages may be absent on some hosts — use lock metadata
    // only so CI and local generators produce identical notices.
    let pkgJson = null
    let licenseFile = null
    if (!optional) {
      const absDir = resolvePackageDir(pkgPath, name)
      try {
        pkgJson = readJson(path.join(absDir, "package.json"))
      } catch {
        // missing package.json
      }
      licenseFile = readLicenseText(absDir)
    }
    const version = info.version || pkgJson?.version || "unknown"
    const license = formatLicenseId(info, pkgJson)
    rows.push({
      name,
      version,
      license,
      optional,
      licenseFile,
      author: optional ? undefined : pkgJson?.author,
    })
  }

  const byName = new Map()
  for (const row of rows) {
    byName.set(row.name, preferRow(byName.get(row.name), row))
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function specialCallout(row) {
  const n = row.name
  if (n === "better-sqlite3-multiple-ciphers") {
    return "SQLite driver with SQLCipher support (bundled SQLCipher). BSD-style licence for the binding; SQLCipher is BSD-3-Clause (Zetetic LLC)."
  }
  if (n === "web-push") {
    return "MPL-2.0 file-level copyleft — source of MPL-covered files is available in this repository and in the distributed package."
  }
  if (n === "sharp" || n.startsWith("@img/sharp")) {
    return "Includes native image-processing components; libvips binaries are LGPL-3.0-or-later where applicable."
  }
  if (n === "caniuse-lite") {
    return "CC-BY-4.0 data licence — attribution required."
  }
  return null
}

function renderEntry(row) {
  const lines = []
  lines.push(`### ${row.name}@${row.version}`)
  lines.push("")
  lines.push(`- **Licence:** ${row.license}${row.optional ? " (optional platform dependency)" : ""}`)
  if (row.author) {
    const author =
      typeof row.author === "string"
        ? row.author
        : row.author.name || row.author.email || JSON.stringify(row.author)
    lines.push(`- **Author:** ${author}`)
  }
  const callout = specialCallout(row)
  if (callout) lines.push(`- **Note:** ${callout}`)
  lines.push("")
  if (row.licenseFile) {
    lines.push(`<details>`)
    lines.push(`<summary>Full licence text (${row.licenseFile.file})</summary>`)
    lines.push("")
    lines.push("```")
    lines.push(row.licenseFile.text)
    lines.push("```")
    lines.push("")
    lines.push(`</details>`)
  } else {
    lines.push("_No bundled licence file found in package; see the SPDX identifier above._")
  }
  lines.push("")
  return lines.join("\n")
}

function main() {
  const lock = readJson(lockPath)
  const packages = collectProductionPackages(lock)
  // Date-stable header so CI can `git diff --exit-code` without daily drift.

  const header = [
    "# Third-Party Notices",
    "",
    "FamilyChart is licensed under the [GNU Affero General Public License v3.0](LICENSE).",
    "Copyright (c) 2026 Benjamin Horder (trading as WheelieLabs).",
    "",
    "This application bundles third-party open-source software. The components below",
    "retain their respective copyrights and licence terms.",
    "",
    "Generated from `package-lock.json`. Regenerate with:",
    "",
    "```bash",
    "node scripts/generate-third-party-notices.mjs",
    "```",
    "",
    `Total production packages: ${packages.length}`,
    "",
    "---",
    "",
  ]

  const body = packages.map(renderEntry).join("\n")
  fs.writeFileSync(outPath, header.join("\n") + body, "utf8")
  console.log(`Wrote ${outPath} (${packages.length} packages)`)
}

main()
