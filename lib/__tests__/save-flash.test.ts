import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { setSaveFlash, takeSaveFlash } from "@/lib/ui/save-flash"

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
}

describe("save flash", () => {
  beforeEach(() => vi.stubGlobal("sessionStorage", memoryStorage()))
  afterEach(() => vi.unstubAllGlobals())

  it("shows once: the second read is empty", () => {
    setSaveFlash("Weight 32.1 kg")
    expect(takeSaveFlash()).toBe("Weight 32.1 kg")
    expect(takeSaveFlash()).toBeNull()
  })

  it("is empty when nothing was saved", () => {
    expect(takeSaveFlash()).toBeNull()
  })

  it("does not throw when storage is blocked", () => {
    const blocked = () => { throw new Error("blocked") }
    vi.stubGlobal("sessionStorage", { getItem: blocked, setItem: blocked, removeItem: blocked })
    expect(() => setSaveFlash("x")).not.toThrow()
    expect(takeSaveFlash()).toBeNull()
  })
})
