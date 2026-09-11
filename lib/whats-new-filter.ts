// SPDX-License-Identifier: AGPL-3.0-only

export interface ChangelogEntry {
  version: string
  date: string
  highlights: string[]
}

export function semverParts(v: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = v.split(".").map(Number)
  return [major, minor, patch]
}

export function semverGt(a: string, b: string): boolean {
  const [aMaj, aMin, aPat] = semverParts(a)
  const [bMaj, bMin, bPat] = semverParts(b)
  if (aMaj !== bMaj) return aMaj > bMaj
  if (aMin !== bMin) return aMin > bMin
  return aPat > bPat
}

export function semverLte(a: string, b: string): boolean {
  return !semverGt(a, b)
}

export function filterWhatsNewEntries(
  entries: ChangelogEntry[],
  lastSeen: string,
  appVersion: string
): ChangelogEntry[] {
  return entries.filter(
    e => semverGt(e.version, lastSeen) && semverLte(e.version, appVersion)
  )
}
