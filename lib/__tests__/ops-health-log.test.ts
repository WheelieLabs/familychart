import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const info = vi.fn()

vi.mock("@/lib/logger", () => ({
  logger: { info },
}))

describe("ops-health-log", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    info.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("emits Healthy on boot and starts periodic heartbeat", async () => {
    const { emitHealthyBootSignal } = await import("@/lib/ops-health-log")
    emitHealthyBootSignal()
    expect(info).toHaveBeenCalledWith("Healthy")

    info.mockClear()
    vi.advanceTimersByTime(5 * 60 * 1000)
    expect(info).toHaveBeenCalledWith("Healthy")
  })

  it("throttles healthcheck emissions to the heartbeat interval", async () => {
    const { emitHealthyFromHealthcheck } = await import("@/lib/ops-health-log")
    emitHealthyFromHealthcheck()
    emitHealthyFromHealthcheck()
    expect(info).toHaveBeenCalledTimes(1)
  })
})
