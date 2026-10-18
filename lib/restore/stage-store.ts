// SPDX-License-Identifier: AGPL-3.0-only

import { randomBytes } from "crypto"
import { once } from "events"
import { createWriteStream, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { EXPORT_FORMAT_VERSION, type ExportManifest } from "@/lib/export/export-manifest"
import { ZipFile, ZipReadError, MANIFEST_MAX_BYTES } from "./zip-file"
import { restoreMaxUploadBytes } from "./upload-limit"

export { restoreMaxUploadBytes }
import { DAMAGED_EXPORT, EXPORT_PREDATES_RESTORE, newerExportMessage, NOT_AN_EXPORT, WRONG_EXPORT_PASSPHRASE } from "./messages"

/** How long a staged upload is kept before plan and apply refuse it. */
export const RESTORE_STAGE_TTL_MS = 30 * 60 * 1000

let stageDirOverride: string | null = null

/** Test-only: stage uploads in this directory (pass null for the default temp directory). */
export function __setRestoreStageDirForTests(dir: string | null): void {
  stageDirOverride = dir
}

export function restoreStageDir(): string {
  return stageDirOverride ?? join(tmpdir(), "familychart-restore")
}

export interface StagedExport {
  id: string
  path: string
  manifest: ExportManifest
}

export class StageError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = "StageError"
  }
}

function assertId(id: string): void {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new StageError("Upload not found", 404)
}

function stagePath(id: string): string {
  assertId(id)
  return join(/*turbopackIgnore: true*/ restoreStageDir(), id)
}

/** Deletes staged uploads older than the window. */
export function sweepExpiredStages(now = Date.now()): void {
  let names: string[]
  try {
    names = readdirSync(/*turbopackIgnore: true*/ restoreStageDir())
  } catch {
    return
  }
  for (const name of names) {
    if (!/^[a-f0-9]{32}$/.test(name)) continue
    const dir = join(/*turbopackIgnore: true*/ restoreStageDir(), name)
    try {
      const created = Number(readFileSync(join(dir, "created"), "utf8"))
      if (!Number.isFinite(created) || now - created > RESTORE_STAGE_TTL_MS) {
        rmSync(dir, { recursive: true, force: true })
      }
    } catch {
      // An upload that has not written its `created` stamp yet is still in progress.
      // Another instance sharing this directory must not delete it mid-write.
      let age = RESTORE_STAGE_TTL_MS + 1
      try {
        age = now - statSync(dir).mtimeMs
      } catch {
        continue
      }
      if (age > RESTORE_STAGE_TTL_MS) rmSync(dir, { recursive: true, force: true })
    }
  }
}

/**
 * Copies the request body to a temporary file, refusing anything over the upload limit,
 * then keeps it only when the manifest is one this importer can read.
 */
export async function stageUpload(body: ReadableStream<Uint8Array> | null): Promise<StagedExport> {
  if (!body) throw new StageError(NOT_AN_EXPORT, 400)
  sweepExpiredStages()
  const id = randomBytes(16).toString("hex")
  const dir = stagePath(id)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "upload.zip")
  const limit = restoreMaxUploadBytes()
  const out = createWriteStream(path)
  out.on("error", () => {
    // A destroyed stream reports the delete that follows an over-limit upload.
  })
  const reader = body.getReader()
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      total += chunk.length
      if (total > limit) {
        throw new StageError(`Upload exceeds the restore limit of ${Math.round(limit / (1024 * 1024))} MB`, 413)
      }
      if (!out.write(chunk)) await once(out, "drain")
    }
    out.end()
    await once(out, "finish")
  } catch (err) {
    out.destroy()
    if (!out.closed) await once(out, "close").catch(() => undefined)
    rmSync(dir, { recursive: true, force: true })
    if (err instanceof StageError) throw err
    throw new StageError(NOT_AN_EXPORT, 400)
  }

  try {
    const manifest = readManifest(path)
    if (manifest.protected) {
      const { assertProtectedContainer } = await import("./protected-zip")
      await assertProtectedContainer(path)
    }
    writeFileSync(join(dir, "created"), String(Date.now()))
    return { id, path, manifest }
  } catch (err) {
    rmSync(dir, { recursive: true, force: true })
    if (err instanceof StageError) throw err
    if (err instanceof ZipReadError) throw new StageError(err.message, 400)
    throw new StageError(NOT_AN_EXPORT, 400)
  }
}

function readManifest(path: string): ExportManifest {
  let zip: ZipFile
  try {
    zip = ZipFile.open(path)
  } catch (err) {
    if (err instanceof ZipReadError) throw new StageError(err.message, 400)
    throw err
  }
  try {
    let raw: Buffer | null
    try {
      raw = zip.read("manifest.json", { maxBytes: MANIFEST_MAX_BYTES })
    } catch (err) {
      if (err instanceof ZipReadError) throw new StageError(err.message, 400)
      throw err
    }
    if (!raw) throw new StageError(EXPORT_PREDATES_RESTORE, 400)
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.toString("utf8"))
    } catch {
      throw new StageError(NOT_AN_EXPORT, 400)
    }
    if (!parsed || typeof parsed !== "object") throw new StageError(NOT_AN_EXPORT, 400)
    const manifest = parsed as Partial<ExportManifest> & { protected?: boolean }
    if (typeof manifest.format_version !== "number" || !Number.isInteger(manifest.format_version)) {
      throw new StageError(NOT_AN_EXPORT, 400)
    }
    if (manifest.format_version > EXPORT_FORMAT_VERSION) {
      const version = typeof manifest.app_version === "string" && manifest.app_version.trim()
        ? manifest.app_version
        : "unknown"
      throw new StageError(newerExportMessage(version), 400)
    }
    if (manifest.scope !== "person" && manifest.scope !== "household") {
      throw new StageError(NOT_AN_EXPORT, 400)
    }
    if (typeof manifest.app_version !== "string" || typeof manifest.exported_at !== "string") {
      throw new StageError(NOT_AN_EXPORT, 400)
    }
    const sections = Array.isArray(manifest.sections) ? manifest.sections.filter((s): s is string => typeof s === "string") : []
    return {
      format_version: manifest.format_version,
      scope: manifest.scope,
      app_version: manifest.app_version,
      exported_at: manifest.exported_at,
      ...(manifest.protected === true ? { protected: true as const } : {}),
      sections,
      counts: manifest.counts && typeof manifest.counts === "object" ? manifest.counts : {},
      skipped_files: Array.isArray(manifest.skipped_files) ? manifest.skipped_files.flatMap(file => {
        if (!file || typeof file !== "object") return []
        const row = file as { path?: unknown; reason?: unknown }
        if (typeof row.path !== "string" || typeof row.reason !== "string") return []
        return [{ path: row.path, reason: row.reason }]
      }) : [],
    }
  } finally {
    zip.close()
  }
}

function requireFreshStage(id: string): string {
  sweepExpiredStages()
  assertId(id)
  const dir = stagePath(id)
  const path = join(dir, "upload.zip")
  let created: number
  try {
    created = Number(readFileSync(join(dir, "created"), "utf8"))
    statSync(path)
  } catch {
    throw new StageError("Upload not found", 404)
  }
  if (!Number.isFinite(created) || Date.now() - created > RESTORE_STAGE_TTL_MS) {
    rmSync(dir, { recursive: true, force: true })
    throw new StageError("This upload has expired. Upload the export again.", 404)
  }
  return path
}

/** A protected upload keeps its contents sealed until the passphrase has opened the check entry. */
function isSealed(manifest: ExportManifest): boolean {
  return manifest.protected === true && manifest.sections.length === 0
}

export function openStaged(id: string): StagedExport {
  const path = requireFreshStage(id)
  const manifest = readManifest(path)
  if (isSealed(manifest)) throw new StageError(WRONG_EXPORT_PASSPHRASE, 400)
  return { id, path, manifest }
}

/**
 * Opens a protected upload. A wrong passphrase leaves the file in place so the next try does not
 * upload it again. Nothing is planned or applied until this succeeds.
 */
export async function unlockStaged(id: string, passphrase: string): Promise<StagedExport> {
  const path = requireFreshStage(id)
  const manifest = readManifest(path)
  if (!isSealed(manifest)) return { id, path, manifest }
  const { unlockProtectedContainer } = await import("./protected-zip")
  await unlockProtectedContainer(path, passphrase)
  const unlocked = readManifest(path)
  if (isSealed(unlocked)) throw new StageError(DAMAGED_EXPORT, 400)
  return { id, path, manifest: unlocked }
}

export function discardStaged(id: string): void {
  try {
    rmSync(stagePath(id), { recursive: true, force: true })
  } catch {
    // Already gone.
  }
}
