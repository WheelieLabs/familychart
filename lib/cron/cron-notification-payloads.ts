// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Builds the push notification payload for each cron reminder kind.
 * All notification copy, deep-link URLs, and tag patterns live here.
 */

import type { ReminderPushPayload } from "@/lib/cron/cron-reminder-delivery"
import { formatCount } from "@/lib/format-count"
import { doseExpectationTag, hydrationReminderTag, medicationReminderTag } from "@/lib/push/notification-tags"
import { hydrationMuteNotificationAction } from "@/lib/push/push-notification-actions"

const ICON = "/icons/icon-192.png"
const BADGE = "/icons/badge-72.png"

const medTag = medicationReminderTag

function medUrl(
  personId: number,
  medicationId: number,
  prompt: string,
  scheduledDosage?: number | null,
): string {
  // Carry the per-slot scheduled dosage so the Record form prefills it.
  const dosageParam =
    scheduledDosage != null && Number.isFinite(scheduledDosage) && scheduledDosage > 0
      ? `&dosage=${scheduledDosage}`
      : ""
  return `/${personId}/record-medication?medication_id=${medicationId}&prompt=${prompt}${dosageParam}`
}

function observationTag(personId: number, observationType: string): string {
  return `observation-reminder-${personId}-${observationType}`
}

function observationUrl(personId: number, observationType: string): string {
  return `/${personId}/record-observation?type=${encodeURIComponent(observationType)}`
}

export function buildPrnPayload(
  personId: number,
  medicationId: number,
  personName: string,
  medName: string,
): ReminderPushPayload {
  return {
    title: "FamilyChart",
    body: `${personName} can have another dose of ${medName}`,
    icon: ICON,
    badge: BADGE,
    tag: medTag(personId, medicationId),
    data: {
      url: medUrl(personId, medicationId, "prn"),
      type: "prn",
    },
  }
}

export function buildScheduledPayload(
  personId: number,
  medicationId: number,
  personName: string,
  medName: string,
  scheduledDosage?: number | null,
): ReminderPushPayload {
  return {
    title: "FamilyChart",
    body: `Time for ${personName}'s ${medName}`,
    icon: ICON,
    badge: BADGE,
    tag: medTag(personId, medicationId),
    data: {
      url: medUrl(personId, medicationId, "scheduled", scheduledDosage),
      type: "scheduled",
    },
  }
}

export function buildOverduePayload(
  personId: number,
  medicationId: number,
  personName: string,
  medName: string,
  scheduledDosage?: number | null,
): ReminderPushPayload {
  return {
    title: "FamilyChart",
    body: `${personName}'s ${medName} is overdue`,
    icon: ICON,
    badge: BADGE,
    tag: medTag(personId, medicationId),
    data: {
      url: medUrl(personId, medicationId, "overdue", scheduledDosage),
      type: "overdue",
    },
  }
}

export function buildObservationPayload(
  personId: number,
  personName: string,
  observationType: string,
): ReminderPushPayload {
  return {
    title: "FamilyChart",
    body: `${personName}: ${observationType} observation overdue`,
    icon: ICON,
    badge: BADGE,
    tag: observationTag(personId, observationType),
    data: {
      url: observationUrl(personId, observationType),
      type: "observation",
    },
  }
}

/** Neutral question for a dose expected away from home; the inline Yes / No / Not yet buttons are on the person page. */
export function buildDoseExpectationPayload(
  personId: number,
  medicationId: number,
  personName: string,
  medName: string,
): ReminderPushPayload {
  return {
    title: "FamilyChart",
    body: `Was ${personName}'s ${medName} given away from home?`,
    icon: ICON,
    badge: BADGE,
    // Own tag: must not replace a dose reminder already on the device for this medication.
    tag: doseExpectationTag(personId, medicationId),
    data: {
      url: `/${personId}`,
      type: "dose_expectation",
    },
  }
}

const hydrationTag = hydrationReminderTag

function hydrationUrl(personId: number): string {
  return `/${personId}/record-observation?type=Hydration`
}

export function buildHydrationPayload(
  personId: number,
  personName: string,
  glassesNeededNow: number,
): ReminderPushPayload {
  return {
    title: "FamilyChart",
    body: `${personName}: ≈${formatCount(glassesNeededNow, "glass", "glasses")} to catch up`,
    icon: ICON,
    badge: BADGE,
    tag: hydrationTag(personId),
    data: {
      url: hydrationUrl(personId),
      type: "hydration",
    },
    actions: [hydrationMuteNotificationAction()],
  }
}

/** How long a "Caught up" notification stays before the service worker closes it. */
export const HYDRATION_CAUGHT_UP_VISIBLE_MS = 4000

/**
 * Replaces the hydration nudge in place with the new count after a reading, still behind. Same tag,
 * silent so a replacement makes no new sound or vibration.
 */
export function buildHydrationUpdatePayload(
  personId: number,
  personName: string,
  glassesNeededNow: number,
): ReminderPushPayload {
  return { ...buildHydrationPayload(personId, personName, glassesNeededNow), silent: true }
}

/**
 * Replaces the hydration nudge once the person has caught up. A push has to show something, so this
 * shows "Caught up" quietly on the same tag and the service worker closes it a few seconds later.
 */
export function buildHydrationCaughtUpPayload(personId: number, personName: string): ReminderPushPayload {
  return {
    title: "FamilyChart",
    body: `${personName}: Caught up`,
    icon: ICON,
    badge: BADGE,
    tag: hydrationTag(personId),
    silent: true,
    closeAfterMs: HYDRATION_CAUGHT_UP_VISIBLE_MS,
    data: {
      url: hydrationUrl(personId),
      type: "hydration",
    },
  }
}

/** Weekly Admin nudge when Entra access is going unrechecked. No personal data; opens the fix page. */
export function buildEntraRevalidationGapPayload(): ReminderPushPayload {
  return {
    title: "FamilyChart",
    body: "Entra access isn't being rechecked. Tap to see what to do.",
    icon: ICON,
    badge: BADGE,
    tag: "entra-revalidation-gap",
    data: {
      url: "/admin/entra-sessions",
      type: "entra-revalidation-gap",
    },
  }
}
