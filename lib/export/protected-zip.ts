// SPDX-License-Identifier: AGPL-3.0-only

import {
  configure,
  Uint8ArrayReader,
  ZipWriter,
} from "@zip.js/zip.js"
import { CONTENTS_ENTRY, CHECK_ENTRY, CHECK_TEXT } from "./protected-entries"
import { MANIFEST_ENTRY, protectedManifestParts, type ExportManifest } from "./export-manifest"
import { isExportPassphrase, normaliseExportPassphrase } from "./export-passphrase"
import type { ExportEntry, ExportEntryContent, ExportZipStreamOptions } from "./export-zip-stream"

configure({ useWebWorkers: false })

const ALREADY_COMPRESSED = /\.(jpe?g|png|webp|gif|heic|heif|avif|pdf|zip)$/i

export class ProtectedExportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProtectedExportError"
  }
}

async function entryBytes(content: ExportEntryContent): Promise<Uint8Array> {
  const value = typeof content === "function" ? await content() : content
  if (typeof value === "string") return new TextEncoder().encode(value)
  return value
}

function manifestFrom(entry: ExportEntry): ExportManifest {
  if (typeof entry.content !== "string") {
    throw new ProtectedExportError("Export failed")
  }
  return JSON.parse(entry.content) as ExportManifest
}

/**
 * Streams an AES-256 zip. The manifest stays unencrypted and first; a check entry and the
 * manifest contents follow, encrypted; every other entry is encrypted. One entry is held at a
 * time, and the archive advances only as the reader pulls.
 */
export function streamProtectedExportZip(
  entries: ExportEntry[],
  passphrase: string,
  options: ExportZipStreamOptions = {},
): ReadableStream<Uint8Array> {
  const password = normaliseExportPassphrase(passphrase)
  if (!isExportPassphrase(password)) throw new ProtectedExportError("Export failed")

  const manifestEntry = entries.find(entry => entry.name === MANIFEST_ENTRY)
  if (!manifestEntry) throw new ProtectedExportError("Export failed")
  const { readable, sealed } = protectedManifestParts(manifestFrom(manifestEntry))
  const rest = entries.filter(entry => entry.name !== MANIFEST_ENTRY)

  const { readable: zipReadable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const zipWriter = new ZipWriter(writable, { bufferedWrite: false, level: 9, keepOrder: true })
  let settled = false
  const finish = (outcome: "completed" | "aborted") => {
    if (settled) return
    settled = true
    options.onClose?.(outcome)
  }

  const encryptedOptions = (name: string) => ({
    password,
    encryptionStrength: 3 as const,
    level: ALREADY_COMPRESSED.test(name) ? 0 : 9,
  })

  const producer = (async () => {
    await zipWriter.add(
      MANIFEST_ENTRY,
      new Uint8ArrayReader(new TextEncoder().encode(JSON.stringify(readable, null, 2))),
      { level: 9 },
    )
    await zipWriter.add(
      CHECK_ENTRY,
      new Uint8ArrayReader(new TextEncoder().encode(CHECK_TEXT)),
      encryptedOptions(CHECK_ENTRY),
    )
    await zipWriter.add(
      CONTENTS_ENTRY,
      new Uint8ArrayReader(new TextEncoder().encode(JSON.stringify(sealed, null, 2))),
      encryptedOptions(CONTENTS_ENTRY),
    )
    for (const entry of rest) {
      await zipWriter.add(entry.name, new Uint8ArrayReader(await entryBytes(entry.content)), encryptedOptions(entry.name))
    }
    await zipWriter.close()
  })()

  const reader = zipReadable.getReader()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          await producer
          finish("completed")
          controller.close()
          return
        }
        controller.enqueue(value)
      } catch (err) {
        finish("aborted")
        controller.error(err)
      }
    },
    cancel() {
      finish("aborted")
      void reader.cancel()
    },
  })
}
