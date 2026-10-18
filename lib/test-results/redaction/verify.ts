// SPDX-License-Identifier: AGPL-3.0-only

/**
 * pdfkit writes text as kerned hex runs inside TJ arrays (`[<46> 30 <657272>] TJ`), so a naive byte
 * scan misses even visible words and would pass a leak. This decodes every TJ run to joined text.
 */
export function decodedPdfText(bytes: Uint8Array): string {
  const raw = new TextDecoder("latin1").decode(bytes)
  return [...raw.matchAll(/\[((?:\s*<[0-9a-fA-F]*>\s*-?[\d.]*)+)\]\s*TJ/g)]
    .map(m => [...m[1]!.matchAll(/<([0-9a-fA-F]*)>/g)].map(h => hexToLatin1(h[1]!)).join(""))
    .join("\n")
}

function hexToLatin1(hex: string): string {
  let out = ""
  for (let i = 0; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
  return out
}

function countOf(haystack: string, needle: string): number {
  let n = 0
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + needle.length)) n++
  return n
}

/**
 * Redacted strings that `text` holds more often than the text meant to be kept (`keptText`) does. The
 * same string legitimately left visible elsewhere is counted on both sides, so only a boxed copy that
 * survived is reported. Strings shorter than three characters are ignored (a lone digit would match anywhere).
 */
export function leakedStrings(secrets: readonly string[], text: string, keptText: string): string[] {
  return [...new Set(secrets.map(s => s.trim()).filter(s => s.length >= 3))].filter(
    secret => countOf(text, secret) > countOf(keptText, secret),
  )
}
