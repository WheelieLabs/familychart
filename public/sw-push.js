importScripts("/push-notification-actions.js")

self.addEventListener("push", (event) => {
  if (!event.data) return
  const data = event.data.json()
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || "/icons/icon-192.png",
      badge: data.badge || "/icons/badge-72.png",
      tag: data.tag || undefined,
      data: data.data || {},
      actions: data.actions || undefined,
      requireInteraction: data.requireInteraction || false,
    }),
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
