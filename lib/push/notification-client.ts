// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Browser side of the notifications a save changes. The recording device closes or quietly updates
 * its own notification by tag (the server skips it when pushing), and names itself on the save
 * request so it is skipped. Every call is best effort: a missing service worker, denied permission or
 * unsupported browser just does nothing, and a failure never blocks a save.
 */

import { RECORDING_ENDPOINT_HEADER } from "@/lib/push/recording-device"
import type { PushPayload } from "@/lib/push"

async function pushRegistration(): Promise<ServiceWorkerRegistration | null> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null
    return (await navigator.serviceWorker.getRegistration()) ?? null
  } catch {
    return null
  }
}

/** Header naming this device by its push subscription; empty when it has none. */
export async function recordingDeviceHeaders(): Promise<Record<string, string>> {
  try {
    const sub = await (await pushRegistration())?.pushManager.getSubscription()
    return sub?.endpoint ? { [RECORDING_ENDPOINT_HEADER]: sub.endpoint } : {}
  } catch {
    return {}
  }
}

/** Closes this device's notification with the given tag, if it is showing one. */
export async function closeNotificationsByTag(tag: string | null | undefined): Promise<void> {
  if (!tag) return
  try {
    const shown = (await (await pushRegistration())?.getNotifications({ tag })) ?? []
    for (const n of shown) n.close()
  } catch {
    /* best effort */
  }
}

type ReplacementOptions = NotificationOptions & { renotify?: boolean; actions?: { action: string; title: string }[] }

/**
 * Replaces a notification this device is already showing, with no new sound or vibration. It never
 * creates one: if the nudge was dismissed there is nothing to update.
 */
export async function updateNotificationQuietly(payload: PushPayload): Promise<void> {
  if (!payload.tag) return
  try {
    const reg = await pushRegistration()
    if (!reg || (await reg.getNotifications({ tag: payload.tag })).length === 0) return
    const options: ReplacementOptions = {
      body: payload.body,
      icon: payload.icon,
      badge: payload.badge,
      tag: payload.tag,
      data: payload.data ?? {},
      actions: payload.actions,
      silent: true,
      renotify: false,
    }
    await reg.showNotification(payload.title, options)
  } catch {
    /* best effort */
  }
}

/** What the server tells the recording device to do with its own hydration notification. */
export interface RecordingDeviceNotification {
  action: "close" | "update"
  tag: string
  payload?: PushPayload
}

export async function applyRecordingDeviceNotification(n: RecordingDeviceNotification | null | undefined): Promise<void> {
  if (!n) return
  if (n.action === "close") await closeNotificationsByTag(n.tag)
  else if (n.payload) await updateNotificationQuietly(n.payload)
}
