// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest"
import { protectedManifestParts, type ExportManifest } from "@/lib/export/export-manifest"

const manifest: ExportManifest = {
  format_version: 1,
  scope: "person",
  app_version: "1.1.0",
  exported_at: "2026-10-11T04:00:00.000Z",
  sections: ["person", "administrations"],
  counts: { person: 1, administrations: 12 },
  skipped_files: [{ path: "attachments/photo.jpg", reason: "The photo file is missing from storage" }],
}

describe("protectedManifestParts", () => {
  it("keeps only the version, scope, app version, export time and protected flag readable", () => {
    expect(protectedManifestParts(manifest).readable).toEqual({
      format_version: 1,
      scope: "person",
      app_version: "1.1.0",
      exported_at: "2026-10-11T04:00:00.000Z",
      protected: true,
    })
  })

  it("moves the sections, counts and skipped files to the encrypted part", () => {
    expect(protectedManifestParts(manifest).sealed).toEqual({
      sections: ["person", "administrations"],
      counts: { person: 1, administrations: 12 },
      skipped_files: [{ path: "attachments/photo.jpg", reason: "The photo file is missing from storage" }],
    })
  })
})
