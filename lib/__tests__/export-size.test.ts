// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest"
import { exportExceedsProxyWarning, formatExportSize } from "@/lib/export/export-size"

const MB = 1024 * 1024

describe("export size copy", () => {
  it("describes a download as about N MB, including the reports", () => {
    expect(formatExportSize(42 * MB, 38 * MB)).toBe("about 42 MB, including 38 MB of reports")
  })

  it("warns only when the export is above 100 MB", () => {
    expect(exportExceedsProxyWarning(100 * MB)).toBe(false)
    expect(exportExceedsProxyWarning(100 * MB + 1)).toBe(true)
  })
})
