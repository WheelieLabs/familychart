// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest"
import type Database from "better-sqlite3-multiple-ciphers"
import { deliverReminder } from "@/lib/cron/cron-reminder-delivery"
import * as push from "@/lib/push"
import type { NotifyField } from "@/lib/push"

vi.mock("@/lib/push", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/push")>()
  return { ...actual, dispatchPersonPush: vi.fn() }
})

const db = {} as Database.Database
const payload = { title: "Reminder", body: "Time for a dose" }

describe("deliverReminder", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("marks the notify field as linked-account-only exclusively for hydration", async () => {
    vi.mocked(push.dispatchPersonPush).mockResolvedValue({ sent: 0, errors: [] })

    const fields: NotifyField[] = [
      "notify_prn",
      "notify_prescribed",
      "notify_overdue",
      "notify_observations",
      "notify_hydration",
    ]

    for (const notifyField of fields) {
      await deliverReminder(db, { refKey: `k:${notifyField}`, personId: 1, notifyField, payload })
    }

    for (const notifyField of fields) {
      expect(push.dispatchPersonPush).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          notifyFields: notifyField,
          linkedAccountOnly: notifyField === "notify_hydration",
        }),
      )
    }
  })

  it("derives the push_log type from the notify field via notifyFieldToLogType", async () => {
    vi.mocked(push.dispatchPersonPush).mockResolvedValue({ sent: 0, errors: [] })

    await deliverReminder(db, { refKey: "k", personId: 1, notifyField: "notify_overdue", payload })

    expect(push.dispatchPersonPush).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ type: "overdue" }),
    )
  })

  it("forwards personId, payload, refKey, and skipIfAlreadySent unchanged", async () => {
    vi.mocked(push.dispatchPersonPush).mockResolvedValue({ sent: 0, errors: [] })

    await deliverReminder(db, {
      refKey: "unique-ref",
      personId: 42,
      notifyField: "notify_prn",
      payload,
      skipIfAlreadySent: true,
    })

    expect(push.dispatchPersonPush).toHaveBeenCalledWith(db, {
      personId: 42,
      notifyFields: "notify_prn",
      payload,
      type: "prn",
      refKey: "unique-ref",
      skipIfAlreadySent: true,
      linkedAccountOnly: false,
    })
  })

  it("returns dispatchPersonPush's result unchanged", async () => {
    vi.mocked(push.dispatchPersonPush).mockResolvedValue({ sent: 2, errors: ["one failed"] })

    const result = await deliverReminder(db, {
      refKey: "k",
      personId: 1,
      notifyField: "notify_prescribed",
      payload,
    })

    expect(result).toEqual({ sent: 2, errors: ["one failed"] })
  })
})
