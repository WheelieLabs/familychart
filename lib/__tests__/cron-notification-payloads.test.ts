import { describe, it, expect } from "vitest"
import {
  buildHydrationPayload,
  buildObservationPayload,
  buildOverduePayload,
  buildPrnPayload,
  buildScheduledPayload,
} from "@/lib/cron/cron-notification-payloads"
import {
  HYDRATION_MUTE_ACTION,
  hydrationMuteNotificationAction,
} from "@/lib/push/push-notification-actions"

describe("buildPrnPayload", () => {
  it("puts the deep-link URL inside data for the service worker", () => {
    const payload = buildPrnPayload(3, 9, "Alex", "Ibuprofen")
    expect(payload.data?.url).toBe("/3/record-medication?medication_id=9&prompt=prn")
  })

  it("does not include notification actions", () => {
    expect(buildPrnPayload(3, 9, "Alex", "Ibuprofen").actions).toBeUndefined()
  })
})

describe("buildScheduledPayload / buildOverduePayload — deep link", () => {
  it("scheduled payload carries the scheduled dosage in the deep link", () => {
    const payload = buildScheduledPayload(3, 9, "Alex", "Panadol", 1)
    expect(payload.data?.url).toBe("/3/record-medication?medication_id=9&prompt=scheduled&dosage=1")
  })

  it("overdue payload carries the scheduled dosage in the deep link", () => {
    const payload = buildOverduePayload(3, 9, "Alex", "Panadol", 2.5)
    expect(payload.data?.url).toBe("/3/record-medication?medication_id=9&prompt=overdue&dosage=2.5")
  })

  it("omits the dosage param when no scheduled dosage is supplied", () => {
    const payload = buildScheduledPayload(3, 9, "Alex", "Panadol")
    expect(payload.data?.url).toBe("/3/record-medication?medication_id=9&prompt=scheduled")
  })

  it("omits the dosage param for a non-positive dosage", () => {
    const payload = buildOverduePayload(3, 9, "Alex", "Panadol", 0)
    expect(payload.data?.url).toBe("/3/record-medication?medication_id=9&prompt=overdue")
  })
})

describe("buildObservationPayload", () => {
  it("puts the record-observation deep link inside data", () => {
    const payload = buildObservationPayload(7, "Sam", "Blood Pressure")
    expect(payload.url).toBeUndefined()
    expect(payload.data?.url).toBe("/7/record-observation?type=Blood%20Pressure")
    expect(payload.data?.type).toBe("observation")
  })

  it("does not include notification actions", () => {
    expect(buildObservationPayload(7, "Sam", "Blood Pressure").actions).toBeUndefined()
  })
})

describe("buildHydrationPayload", () => {
  it("puts the record-observation deep link inside data", () => {
    const payload = buildHydrationPayload(4, "Alex", 3)
    expect(payload.url).toBeUndefined()
    expect(payload.data?.url).toBe("/4/record-observation?type=Hydration")
    expect(payload.data?.type).toBe("hydration")
    expect(payload.body).toContain("≈3 glasses")
  })

  it("includes a mute-for-today action for the service worker", () => {
    const payload = buildHydrationPayload(4, "Alex", 3)
    expect(payload.actions).toEqual([hydrationMuteNotificationAction()])
    expect(payload.actions?.[0]?.action).toBe(HYDRATION_MUTE_ACTION)
  })
})
