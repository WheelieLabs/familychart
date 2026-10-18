// SPDX-License-Identifier: AGPL-3.0-only

/** Action-screen grid cap: four rows of two. Past it, the least frequent actions move behind "More". */
export const ACTION_TILE_CAP = 8

export type StatusSlide = "alerts" | "timeline"

/** Both status panels share this fixed height, so the tile grid below never moves between states. */
export const STATUS_PANEL_HEIGHT_PX = 200

/** The status region always has both panels (an empty timeline shows an empty state), for every Person. */
export function statusSlides(): StatusSlide[] {
  return ["alerts", "timeline"]
}

/**
 * Which slide the status region opens on. A `timeline` query param (the Live Feed "View on timeline"
 * link) always wins so the linked marker is on screen. Otherwise alerts take over, and with none the
 * timeline opens only when it has something to show: an empty timeline is never the first thing seen.
 */
export function initialStatusSlide(opts: {
  hasAlerts: boolean
  hasTimelineContent: boolean
  timelineParam: string | null
}): StatusSlide {
  if (opts.timelineParam) return "timeline"
  if (opts.hasAlerts) return "alerts"
  return opts.hasTimelineContent ? "timeline" : "alerts"
}

/**
 * Splits tiles (ordered most to least frequent) into the grid and the "More" list. Within the cap
 * everything is visible; past it the grid keeps cap-1 tiles and the single More tile takes the last cell.
 */
export function partitionActionTiles<T>(tiles: T[]): { visible: T[]; more: T[] } {
  if (tiles.length <= ACTION_TILE_CAP) return { visible: tiles, more: [] }
  return { visible: tiles.slice(0, ACTION_TILE_CAP - 1), more: tiles.slice(ACTION_TILE_CAP - 1) }
}
