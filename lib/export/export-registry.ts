// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Per-Person count of export streams in progress, so erase can refuse while a download of that
 * Person is still running. Process-local: the app runs as a single Node process.
 */
const inFlight = new Map<number, number>()

export function exportsInFlight(personId: number): number {
  return inFlight.get(personId) ?? 0
}

/** Counts an export of these Persons as started. The returned release is safe to call more than once. */
export function beginExport(personIds: number[]): () => void {
  for (const id of personIds) inFlight.set(id, exportsInFlight(id) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    for (const id of personIds) {
      const remaining = exportsInFlight(id) - 1
      if (remaining > 0) inFlight.set(id, remaining)
      else inFlight.delete(id)
    }
  }
}
