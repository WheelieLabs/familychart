// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it } from "vitest"
import {
  DEMO_PLATFORM_PROFILE,
  isDemoModeActive,
  validateDemoModeAtBoot,
} from "@/lib/demo/demo-mode"

describe("demo-mode", () => {
  const originalDemo = process.env.DEMO_MODE
  const originalProfile = process.env.FC_PLATFORM_PROFILE

  afterEach(() => {
    if (originalDemo === undefined) delete process.env.DEMO_MODE
    else process.env.DEMO_MODE = originalDemo
    if (originalProfile === undefined) delete process.env.FC_PLATFORM_PROFILE
    else process.env.FC_PLATFORM_PROFILE = originalProfile
  })

  it("is inactive when DEMO_MODE is unset", () => {
    delete process.env.DEMO_MODE
    process.env.FC_PLATFORM_PROFILE = DEMO_PLATFORM_PROFILE
    expect(isDemoModeActive()).toBe(false)
  })

  it("is inactive on self-host even when DEMO_MODE=true", () => {
    process.env.DEMO_MODE = "true"
    delete process.env.FC_PLATFORM_PROFILE
    expect(isDemoModeActive()).toBe(false)
    expect(() => validateDemoModeAtBoot()).not.toThrow()
  })

  it("is active only with DEMO_MODE and demo platform profile", () => {
    process.env.DEMO_MODE = "true"
    process.env.FC_PLATFORM_PROFILE = DEMO_PLATFORM_PROFILE
    expect(isDemoModeActive()).toBe(true)
    expect(() => validateDemoModeAtBoot()).not.toThrow()
  })

  it("fail-fast when DEMO_MODE is set under a non-demo platform profile", () => {
    process.env.DEMO_MODE = "true"
    process.env.FC_PLATFORM_PROFILE = "managed"
    expect(isDemoModeActive()).toBe(false)
    expect(() => validateDemoModeAtBoot()).toThrow(/FC_PLATFORM_PROFILE=demo/)
  })
})
