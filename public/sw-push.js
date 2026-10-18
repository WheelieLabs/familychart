importScripts("/push-notification-actions.js")

self.addEventListener("push", (event) => {
  if (!event.data) return
  const data = event.data.json()
  const shown = self.registration.showNotification(data.title, {
    body: data.body,
    icon: data.icon || "/icons/icon-192.png",
    badge: data.badge || "/icons/badge-72.png",
    tag: data.tag || undefined,
    data: data.data || {},
    actions: data.actions || undefined,
    requireInteraction: data.requireInteraction || false,
    // A quiet in-place replacement: no new sound or vibration.
    silent: data.silent === true,
  })
  // A push has to show something, so "Caught up" is shown briefly and closed again. The wait is
  // capped so a bad value cannot keep the worker alive.
  const closeAfterMs =
    data.tag && typeof data.closeAfterMs === "number" && data.closeAfterMs > 0
      ? Math.min(data.closeAfterMs, 10000)
      : 0
  event.waitUntil(
    closeAfterMs
      ? shown
          .then(() => new Promise((resolve) => setTimeout(resolve, closeAfterMs)))
          .then(() => self.registration.getNotifications({ tag: data.tag }))
          .then((open) => open.forEach((n) => n.close()))
      : shown,
  )
})

function openOrFocusNotificationUrl(url) {
  return self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((clients) => {
      const existing = clients.find(
        (c) =>
          new URL(c.url).origin ===
          new URL(url, self.location.origin).origin,
      )
      if (existing) {
        return existing.focus().then(() => existing.navigate(url))
      }
      return self.clients.openWindow(url)
    })
}

function muteHydrationForToday() {
  return fetch(FC_HYDRATION_MUTE_URL, {
    method: "POST",
    credentials: "include",
  }).catch(() => {
    /* unauthenticated or offline — no navigation */
  })
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close()

  const action = event.action
  const data = event.notification.data || {}
  const mode = fcResolveNotificationClickMode(action, data)

  if (mode === "mute") {
    event.waitUntil(muteHydrationForToday())
    return
  }

  if (mode === "dismiss") {
    return
  }

  const url = data.url || "/"
  event.waitUntil(openOrFocusNotificationUrl(url))
})
