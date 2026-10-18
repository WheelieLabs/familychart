// SPDX-License-Identifier: AGPL-3.0-only

/** Most bound variables one statement takes; SQLite's default limit is far higher, but statements stay small. */
export const SQL_CHUNK_SIZE = 500

/** Splits `items` into arrays of at most `size`, in order. An empty list gives no chunks. */
export function chunkItems<T>(items: readonly T[], size: number = SQL_CHUNK_SIZE): T[][] {
  const chunks: T[][] = []
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size))
  return chunks
}

/** Runs `run` once per chunk of `items` and concatenates what it returns, so no statement binds more than `size` ids. */
export function runInChunks<T, R>(items: readonly T[], run: (chunk: T[]) => R[], size: number = SQL_CHUNK_SIZE): R[] {
  return chunkItems(items, size).flatMap(chunk => run(chunk))
}
