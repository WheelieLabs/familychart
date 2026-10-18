import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"

const ALLOWLIST_FILE = "e2e/axe-allowlist.json"
const FOUND_DIR = "test-results/axe-found"

/**
 * With FC_UI_WRITE_ALLOWLIST=1, prunes the axe allowlist to the violations the scan still found.
 * It only removes entries: a route that was not scanned, or a rule that was not on the list, is left
 * as it was.
 */
export default function globalTeardown() {
  if (!process.env.FC_UI_WRITE_ALLOWLIST || !existsSync(FOUND_DIR)) return
  const allowlist = JSON.parse(readFileSync(ALLOWLIST_FILE, "utf8")) as Record<string, string[]>
  for (const file of readdirSync(FOUND_DIR)) {
    const key = decodeURIComponent(file.replace(/\.json$/, ""))
    const found = new Set(JSON.parse(readFileSync(`${FOUND_DIR}/${file}`, "utf8")) as string[])
    const remaining = (allowlist[key] ?? []).filter(id => found.has(id))
    if (remaining.length === 0) delete allowlist[key]
    else allowlist[key] = remaining.sort()
  }
  const sorted = Object.fromEntries(Object.entries(allowlist).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(ALLOWLIST_FILE, JSON.stringify(sorted, null, 2) + "\n")
  rmSync(FOUND_DIR, { recursive: true })
}
