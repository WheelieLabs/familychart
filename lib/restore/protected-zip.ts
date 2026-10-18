// SPDX-License-Identifier: AGPL-3.0-only

import { ZipArchive } from "archiver"
import { once } from "events"
import { createWriteStream, openAsBlob, renameSync, unlinkSync } from "fs"
import {
  BlobReader,
  configure,
  ERR_INVALID_AUTHENTICATION_CODE,
  ERR_INVALID_PASSWORD,
  Uint8ArrayWriter,
  ZipReader,
  type Entry,
  type FileEntry,
} from "@zip.js/zip.js"
import { CHECK_ENTRY, CHECK_TEXT, CONTENTS_ENTRY } from "@/lib/export/protected-entries"
import { MANIFEST_ENTRY, type ExportManifest, type ManifestContents } from "@/lib/export/export-manifest"
import { normaliseExportPassphrase } from "@/lib/export/export-passphrase"
import { DAMAGED_EXPORT, NOT_AN_EXPORT, UNSUPPORTED_EXPORT_ENCRYPTION, WRONG_EXPORT_PASSPHRASE } from "./messages"
import { StageError } from "./stage-store"

configure({ useWebWorkers: false })

const ALREADY_COMPRESSED = /\.(jpe?g|png|webp|gif|heic|heif|avif|pdf|zip)$/i

function files(entries: Entry[]): FileEntry[] {
  return entries.filter((entry): entry is FileEntry => !entry.directory && !entry.filename.endsWith("/"))
}

function isAes256(entry: Entry): boolean {
  return entry.encrypted === true && entry.zipCrypto !== true && entry.extraFieldAES?.strength === 3
}

/** Refuses a protected zip whose cipher is not AES-256, or whose layout is not one we can open. */
export async function assertProtectedContainer(path: string): Promise<void> {
  const entries = files(await listEntries(path))
  const manifest = entries[0]
  if (!manifest || manifest.filename !== MANIFEST_ENTRY || manifest.encrypted) {
    throw new StageError(NOT_AN_EXPORT, 400)
  }
  const rest = entries.slice(1)
  if (!rest.some(entry => entry.filename === CHECK_ENTRY) || !rest.some(entry => entry.filename === CONTENTS_ENTRY)) {
    throw new StageError(DAMAGED_EXPORT, 400)
  }
  if (rest.some(entry => !isAes256(entry))) {
    throw new StageError(UNSUPPORTED_EXPORT_ENCRYPTION, 400)
  }
}

/**
 * Checks the passphrase against the check entry, then rewrites the upload as a plain zip with the
 * full manifest. The passphrase is not written. A wrong passphrase leaves the encrypted file as it was.
 */
export async function unlockProtectedContainer(path: string, passphrase: string): Promise<void> {
  await assertProtectedContainer(path)
  const password = normaliseExportPassphrase(passphrase)
  const blob = await openAsBlob(path)
  const reader = new ZipReader(new BlobReader(blob))
  const plainPath = `${path}.plain`
  try {
    const entries = files(await reader.getEntries())
    const check = entries.find(entry => entry.filename === CHECK_ENTRY)
    const contents = entries.find(entry => entry.filename === CONTENTS_ENTRY)
    if (!check || !contents) throw new StageError(DAMAGED_EXPORT, 400)

    let checkBytes: Uint8Array
    try {
      checkBytes = await check.getData(new Uint8ArrayWriter(), { password })
    } catch (err) {
      throw mapCheckError(err)
    }
    if (new TextDecoder().decode(checkBytes) !== CHECK_TEXT) throw new StageError(NOT_AN_EXPORT, 400)

    let sealed: ManifestContents
    try {
      const raw = await contents.getData(new Uint8ArrayWriter(), { password })
      sealed = JSON.parse(new TextDecoder().decode(raw)) as ManifestContents
    } catch (err) {
      throw mapDataError(err)
    }

    const headerEntry = entries.find(entry => entry.filename === MANIFEST_ENTRY)
    if (!headerEntry) throw new StageError(DAMAGED_EXPORT, 400)
    const header = JSON.parse(new TextDecoder().decode(await headerEntry.getData(new Uint8ArrayWriter()))) as ExportManifest
    const manifest: ExportManifest = {
      format_version: header.format_version,
      scope: header.scope,
      app_version: header.app_version,
      exported_at: header.exported_at,
      protected: true,
      sections: Array.isArray(sealed.sections) ? sealed.sections : [],
      counts: sealed.counts && typeof sealed.counts === "object" ? sealed.counts : {},
      skipped_files: Array.isArray(sealed.skipped_files) ? sealed.skipped_files : [],
    }

    await writePlainZip(plainPath, manifest, entries, password)
    renameSync(plainPath, path)
  } finally {
    await reader.close()
  }
}

async function listEntries(path: string): Promise<Entry[]> {
  const blob = await openAsBlob(path)
  const reader = new ZipReader(new BlobReader(blob))
  try {
    return await reader.getEntries()
  } catch {
    throw new StageError(DAMAGED_EXPORT, 400)
  } finally {
    await reader.close()
  }
}

function mapCheckError(err: unknown): StageError {
  const message = err instanceof Error ? err.message : ""
  if (message === ERR_INVALID_PASSWORD || message === ERR_INVALID_AUTHENTICATION_CODE) {
    return new StageError(WRONG_EXPORT_PASSPHRASE, 400)
  }
  return new StageError(DAMAGED_EXPORT, 400)
}

function mapDataError(err: unknown): StageError {
  if (err instanceof StageError) return err
  return new StageError(DAMAGED_EXPORT, 400)
}

async function writePlainZip(plainPath: string, manifest: ExportManifest, entries: FileEntry[], password: string): Promise<void> {
  const archive = new ZipArchive({ zlib: { level: 9 } })
  const out = createWriteStream(plainPath)
  archive.pipe(out)
  const append = (name: string, content: Buffer) => new Promise<void>((resolve, reject) => {
    const done = () => {
      archive.off("entry", done)
      archive.off("error", reject)
      resolve()
    }
    archive.once("entry", done)
    archive.once("error", reject)
    archive.append(content, { name, store: ALREADY_COMPRESSED.test(name) })
  })
  try {
    await append(MANIFEST_ENTRY, Buffer.from(JSON.stringify(manifest, null, 2)))
    for (const entry of entries) {
      if (entry.filename === MANIFEST_ENTRY || entry.filename === CHECK_ENTRY || entry.filename === CONTENTS_ENTRY) continue
      let bytes: Uint8Array
      try {
        bytes = await entry.getData(new Uint8ArrayWriter(), { password })
      } catch (err) {
        throw mapDataError(err)
      }
      await append(entry.filename, Buffer.from(bytes))
    }
    await archive.finalize()
    await once(out, "finish")
  } catch (err) {
    archive.abort()
    out.destroy()
    try { unlinkSync(plainPath) } catch { /* not written yet */ }
    if (err instanceof StageError) throw err
    throw new StageError(DAMAGED_EXPORT, 400)
  }
}
