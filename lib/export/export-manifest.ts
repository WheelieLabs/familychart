// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The export format version. Raise it whenever a section is added: an importer refuses any
 * version higher than it understands (forwards-only compatibility).
 */
export const EXPORT_FORMAT_VERSION = 2

export const MANIFEST_ENTRY = "manifest.json"

export type ExportScope = "person" | "household"

/** A file the export meant to include but could not, by its bundle path. */
export interface SkippedFile {
  path: string
  reason: string
}

/** The fields that stay readable in every export, protected or not. */
export interface ManifestHeader {
  format_version: number
  scope: ExportScope
  app_version: string
  exported_at: string
}

/** The fields that describe the contents; a protected export encrypts these. */
export interface ManifestContents {
  sections: string[]
  /** Records per section, read by the restore preview. */
  counts: Record<string, number>
  skipped_files: SkippedFile[]
}

export type ExportManifest = ManifestHeader & ManifestContents & {
  /** Set when the file was passphrase-protected. Encryption does not change the format version. */
  protected?: true
}

/** Splits a manifest for a protected export: a minimal readable header and the contents to encrypt. */
export function protectedManifestParts(manifest: ExportManifest): {
  readable: ManifestHeader & { protected: true }
  sealed: ManifestContents
} {
  const { format_version, scope, app_version, exported_at, sections, counts, skipped_files } = manifest
  return {
    readable: { format_version, scope, app_version, exported_at, protected: true },
    sealed: { sections, counts, skipped_files },
  }
}
