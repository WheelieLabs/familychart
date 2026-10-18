import { describe, expect, it } from "vitest"
import {
  ACTION_TILE_CAP,
  STATUS_PANEL_HEIGHT_PX,
  initialStatusSlide,
  partitionActionTiles,
  statusSlides,
} from "@/lib/person/action-screen"

const tile = (n: number) => ({ href: `/p/${n}`, icon: "x", title: `Tile ${n}` })
const tiles = (count: number) => Array.from({ length: count }, (_, i) => tile(i + 1))

describe("initialStatusSlide", () => {
  it("opens on alerts when any alert exists", () => {
    expect(initialStatusSlide({ hasAlerts: true, hasTimelineContent: true, timelineParam: null })).toBe("alerts")
  })

  it("opens on the timeline with no alerts when it has something to show", () => {
    expect(initialStatusSlide({ hasAlerts: false, hasTimelineContent: true, timelineParam: null })).toBe("timeline")
  })

  it("opens on alerts, not an empty timeline, when there is nothing in either", () => {
    expect(initialStatusSlide({ hasAlerts: false, hasTimelineContent: false, timelineParam: null })).toBe("alerts")
  })

  it("lets a timeline query param override alerts", () => {
    expect(initialStatusSlide({ hasAlerts: true, hasTimelineContent: true, timelineParam: "med:12" })).toBe("timeline")
    expect(initialStatusSlide({ hasAlerts: false, hasTimelineContent: false, timelineParam: "med:12" })).toBe("timeline")
  })
})

describe("statusSlides", () => {
  it("always has both panels, whatever the person's data", () => {
    expect(statusSlides()).toEqual(["alerts", "timeline"])
  })
})

describe("status panel height", () => {
  it("is one fixed height shared by both panels", () => {
    expect(STATUS_PANEL_HEIGHT_PX).toBe(200)
  })
})

describe("partitionActionTiles", () => {
  it("shows every tile up to the cap with no More tile", () => {
    const result = partitionActionTiles(tiles(6))
    expect(result.visible).toHaveLength(6)
    expect(result.more).toEqual([])
    expect(partitionActionTiles(tiles(ACTION_TILE_CAP)).more).toEqual([])
  })

  it("keeps the grid at the cap past it: the first cap-1 tiles plus a More list of the rest", () => {
    const all = tiles(ACTION_TILE_CAP + 2)
    const result = partitionActionTiles(all)
    expect(result.visible).toEqual(all.slice(0, ACTION_TILE_CAP - 1))
    expect(result.more).toEqual(all.slice(ACTION_TILE_CAP - 1))
    // Grid cells = visible tiles + the single More tile.
    expect(result.visible.length + 1).toBe(ACTION_TILE_CAP)
  })

  it("caps at 8 tiles (four rows of two)", () => {
    expect(ACTION_TILE_CAP).toBe(8)
  })
})
