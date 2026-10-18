// SPDX-License-Identifier: AGPL-3.0-only

import { announce } from "@/lib/announce"

/**
 * Person ids whose export stream the page has read to the end. A later action, such as erase,
 * can wait on this instead of treating a click as a finished download.
 */
const started = new Set<number>()
const finished = new Set<number>()
const listeners = new Set<() => void>()

function emitExportState(): void {
  for (const listener of listeners) listener()
}

export function personExportStreamFinished(personId: number): boolean {
  return finished.has(personId)
}

/** True after a download has started on this page and before the stream has been read to the end. */
export function personExportInFlight(personId: number): boolean {
  return started.has(personId) && !finished.has(personId)
}

export function subscribePersonExports(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function resetPersonExportDownloadsForTests(): void {
  started.clear()
  finished.clear()
}

function filenameFromDisposition(header: string | null): string {
  const match = header?.match(/filename="([^"]+)"/)
  return match?.[1] || "export.zip"
}

function saveExportFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** Reads a Person export to the end, records that, then saves the file. */
export async function downloadPersonExport(personId: number, passphrase?: string | null): Promise<void> {
  started.add(personId)
  finished.delete(personId)
  emitExportState()
  try {
    const res = passphrase
      ? await fetch(`/api/people/${personId}/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase }),
      })
      : await fetch(`/api/people/${personId}/export`)
    if (!res.ok || !res.body) throw new Error("Export failed")
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    finished.add(personId)
    announce("Download finished", "polite")
    saveExportFile(new Blob(chunks as BlobPart[], { type: "application/zip" }), filenameFromDisposition(res.headers.get("Content-Disposition")))
  } finally {
    if (!finished.has(personId)) started.delete(personId)
    emitExportState()
  }
}
