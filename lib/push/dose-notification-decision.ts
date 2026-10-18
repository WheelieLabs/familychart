// SPDX-License-Identifier: AGPL-3.0-only

import { medicationReminderTag } from "@/lib/push/notification-tags"

export interface DoseNotificationDecision {
  /** Tag the recording device closes; null when the reminder stays. */
  closeTag: string | null
  /** The recorder's other devices get "You gave…" in place of the reminder. */
  replaceOnRecorderDevices: boolean
}

/**
 * Whether saving a dose clears the dose reminder, returned as data so no real push is sent in tests.
 * Only a dose that itself attached to a slot (On time, or answered Late or Early) clears it. A PRN,
 * unscheduled or extra dose, and a dose still waiting for its answer, leave the reminder alone so a
 * dose still due is not hidden, even if saving it also settled some slot of the medication as Missed.
 */
export function decideDoseNotification(
  input: {
    personId: number
    medicationId: number
    clearsReminder: boolean
  },
): DoseNotificationDecision {
  return input.clearsReminder
    ? { closeTag: medicationReminderTag(input.personId, input.medicationId), replaceOnRecorderDevices: true }
    : { closeTag: null, replaceOnRecorderDevices: false }
}
