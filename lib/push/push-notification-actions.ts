// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Push notification action IDs and click routing shared by the service worker
 * (public/push-notification-actions.js) and server payloads (cron-notification-payloads).
 */

export const HYDRATION_NOTIFICATION_TYPE = "hydration"

/** `event.action` value for the hydration "Mute for today" button (PR5b payload). */
export const HYDRATION_MUTE_ACTION = "mute-today"

export const HYDRATION_MUTE_API = "/api/me/hydration-mute"

export interface PushNotificationAction {
  action: string
  title: string
}

/** Action entry for hydration push payloads (wired in PR5b). */
export function hydrationMuteNotificationAction(): PushNotificationAction {
  return { action: HYDRATION_MUTE_ACTION, title: "Mute for today" }
}

export function isHydrationMuteClick(
  action: string | undefined,
  notificationData: Record<string, unknown> | undefined,
): boolean {
  return (
    action === HYDRATION_MUTE_ACTION &&
    notificationData?.type === HYDRATION_NOTIFICATION_TYPE
  )
}

/** How the service worker should handle a notificationclick. */
export function resolveNotificationClickMode(
  action: string | undefined,
  notificationData: Record<string, unknown> | undefined,
): "mute" | "navigate" | "dismiss" {
  if (!action) return "navigate"
  if (isHydrationMuteClick(action, notificationData)) return "mute"
  return "dismiss"
}
