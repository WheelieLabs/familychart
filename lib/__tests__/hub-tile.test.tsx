// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import * as HubTile from "@/components/ui/HubTile"

describe("HubTile exports", () => {
  it("does not export HubPlaceholder", () => {
    expect("HubPlaceholder" in HubTile).toBe(false)
  })
})
