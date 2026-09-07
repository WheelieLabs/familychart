// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Builds the push notification payload for each cron reminder kind.
 * All notification copy, deep-link URLs, and tag patterns live here.
 */

import type { ReminderPushPayload } from "@/lib/cron/cron-reminder-delivery"
import { formatCount } from "@/lib/format-count"
import { hydrationMuteNotificationAction } from "@/lib/push/push-notification-actions"

const ICON = "/icons/icon-192.png"
const BADGE = "/icons/badge-72.png"

function medTag(personId: number, medicationId: number): string {
  return `medication-reminder-${personId}-${medicationId}`
}

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

function hydrationTag(personId: number): string {
  return `hydration-reminder-${personId}`
}

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
