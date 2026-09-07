import { describe, it, expect } from "vitest"
import {
  HYDRATION_MUTE_ACTION,
  HYDRATION_NOTIFICATION_TYPE,
  hydrationMuteNotificationAction,
  isHydrationMuteClick,
  resolveNotificationClickMode,
} from "@/lib/push/push-notification-actions"

describe("isHydrationMuteClick", () => {
  it("matches hydration mute action only for hydration notifications", () => {
    expect(
      isHydrationMuteClick(HYDRATION_MUTE_ACTION, {
        type: HYDRATION_NOTIFICATION_TYPE,
        url: "/4/record-observation?type=Hydration",
      }),
    ).toBe(true)
  })

  it("rejects mute action on non-hydration notification classes", () => {
    expect(
      isHydrationMuteClick(HYDRATION_MUTE_ACTION, {
        type: "observation",
        url: "/4/record-observation?type=Weight",
      }),
    ).toBe(false)
    expect(
      isHydrationMuteClick(HYDRATION_MUTE_ACTION, {
        type: "scheduled",
        url: "/4/record-medication?medication_id=1&prompt=scheduled",
      }),
    ).toBe(false)
  })

  it("rejects hydration body clicks (empty action)", () => {
    expect(
      isHydrationMuteClick("", {
        type: HYDRATION_NOTIFICATION_TYPE,
      }),
    ).toBe(false)
    expect(
      isHydrationMuteClick(undefined, {
        type: HYDRATION_NOTIFICATION_TYPE,
      }),
    ).toBe(false)
  })
})

describe("resolveNotificationClickMode", () => {
  it("navigates on default body click", () => {
    expect(
      resolveNotificationClickMode("", {
        type: HYDRATION_NOTIFICATION_TYPE,
        url: "/4/record-observation?type=Hydration",
      }),
    ).toBe("navigate")
    expect(
      resolveNotificationClickMode(undefined, {
        type: "observation",
        url: "/7/record-observation?type=Weight",
      }),
    ).toBe("navigate")
  })

  it("mutes on hydration mute action without navigation", () => {
    expect(
      resolveNotificationClickMode(HYDRATION_MUTE_ACTION, {
        type: HYDRATION_NOTIFICATION_TYPE,
      }),
    ).toBe("mute")
  })

  it("dismisses unknown action clicks without navigation", () => {
    expect(
      resolveNotificationClickMode("other-action", {
        type: HYDRATION_NOTIFICATION_TYPE,
      }),
    ).toBe("dismiss")
    expect(
      resolveNotificationClickMode(HYDRATION_MUTE_ACTION, {
        type: "prn",
      }),
    ).toBe("dismiss")
  })
})

describe("hydrationMuteNotificationAction", () => {
  it("uses the mute action id expected by the service worker", () => {
    expect(hydrationMuteNotificationAction()).toEqual({
      action: HYDRATION_MUTE_ACTION,
      title: "Mute for today",
    })
  })
})
