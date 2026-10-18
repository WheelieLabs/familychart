import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/** Deliberate run-on-trigger-only effects; each disable must state why. */
const FILES_WITH_DOCUMENTED_DISABLES = [
  "app/[personId]/schedules-goals/SchedulesGoalsClient.tsx",
  "app/[personId]/record-medication/page.tsx",
  "app/profile/page.tsx",
  "components/Modal.tsx",
  "components/AppLockOverlay.tsx",
]

function linesMissingExhaustiveDepsReason(relativePath: string): string[] {
  const content = readFileSync(join(process.cwd(), relativePath), "utf8")
  return content.split("\n").filter(line => {
    if (!/react-hooks\/exhaustive-deps/.test(line)) return false
    return !/--\s+\S/.test(line)
  })
}

describe("react-hooks/exhaustive-deps disable comments", () => {
  it.each(FILES_WITH_DOCUMENTED_DISABLES)("%s documents each disable with a reason", path => {
    expect(linesMissingExhaustiveDepsReason(path)).toEqual([])
  })
})
