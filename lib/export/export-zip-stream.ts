// SPDX-License-Identifier: AGPL-3.0-only

import { ZipArchive } from "archiver"

/** Entry content: inline text or bytes, or a loader called only when the entry is written. */
export type ExportEntryContent = string | Buffer | (() => Promise<Buffer>)

export interface ExportEntry {
  name: string
  content: ExportEntryContent
}

const ALREADY_COMPRESSED = /\.(jpe?g|png|webp|gif|heic|heif|avif|pdf|zip)$/i

export interface ExportZipStreamOptions {
  /** Called exactly once when the stream ends, fails or is cancelled by the reader. */
  onClose?: (outcome: "completed" | "aborted") => void
}

/**
 * Streams a zip of the entries in order. Each entry is appended only after the previous one has
 * been written, and the archive only advances as the reader pulls, so at most one attachment is
 * held in memory. Already-compressed files are stored as they are.
 */
export function streamExportZip(entries: ExportEntry[], options: ExportZipStreamOptions = {}): ReadableStream<Uint8Array> {
  const archive = new ZipArchive({ zlib: { level: 9 } })
  let closed = false
  let failure: Error | null = null
  let ended = false
  const close = (outcome: "completed" | "aborted") => {
    if (closed) return
    closed = true
    options.onClose?.(outcome)
  }
  archive.on("error", err => {
    failure = err
    close("aborted")
  })
  archive.on("end", () => {
    ended = true
    close("completed")
  })

  const appendNext = (name: string, content: string | Buffer) =>
    new Promise<void>((resolve, reject) => {
      const done = () => {
        archive.off("entry", done)
        archive.off("error", reject)
        resolve()
      }
      archive.once("entry", done)
      archive.once("error", reject)
      archive.append(content, { name, store: ALREADY_COMPRESSED.test(name) })
    })

  void (async () => {
    for (const entry of entries) {
      if (closed) return
      const content = typeof entry.content === "function" ? await entry.content() : entry.content
      await appendNext(entry.name, content)
    }
    await archive.finalize()
  })().catch(err => {
    if (closed) return
    archive.emit("error", err instanceof Error ? err : new Error(String(err)))
  })

  const nextEvent = () =>
    new Promise<void>(resolve => {
      const done = () => {
        archive.off("readable", done)
        archive.off("end", done)
        archive.off("error", done)
        resolve()
      }
      archive.once("readable", done)
      archive.once("end", done)
      archive.once("error", done)
    })

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (failure) {
          controller.error(failure)
          return
        }
        const chunk = archive.read() as Buffer | null
        if (chunk !== null) {
          controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength))
          return
        }
        if (ended) {
          controller.close()
          return
        }
        await nextEvent()
      }
    },
    cancel() {
      close("aborted")
      archive.abort()
    },
  })
}
