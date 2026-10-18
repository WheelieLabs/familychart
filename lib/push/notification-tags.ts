// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Notification tags. A notification with the same tag replaces the one already on a device, and the
 * recording device closes a notification by its tag, so the cron reminders, the acknowledgement
 * pushes and the client all have to agree on these strings.
 */

/** Dose reminders (PRN, scheduled, overdue) and their acknowledgement share one tag per Person medication. */
export function medicationReminderTag(personId: number, medicationId: number): string {
  return `medication-reminder-${personId}-${medicationId}`
}

/** The "was it given away from home?" question has its own tag so it never replaces a dose reminder. */
export function doseExpectationTag(personId: number, medicationId: number): string {
  return `dose-expectation-${personId}-${medicationId}`
}

export function hydrationReminderTag(personId: number): string {
  return `hydration-reminder-${personId}`
}
