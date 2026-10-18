# ADR-0030: The recorder's own notifications update and clear, quietly where they can

**Status:** Accepted — implemented in 1.1.0

## Context

Saving a dose already replaced other people's reminders with "<name> gave…", but the acknowledgement push excludes the person who recorded it. Their own "due" or "overdue" notification stayed on screen after the dose was given. A hydration nudge likewise stayed after the person had drunk enough. Web Push cannot remove a notification from a device: a push has to show something, and only the device itself (or its service worker) can close one.

## Decision

- **Tags.** One notification tag per Person medication for dose reminders and their acknowledgement, one per Person for hydration, and a separate tag for the "given away from home?" question, so it never replaces a dose reminder. Cron, the acknowledgement pushes and the client share the tag functions in `lib/push/notification-tags.ts`.
- **The recording device closes its own notification itself**, by tag, as soon as the save returns (`closeNotificationTag` on the response). A push cannot do this remotely.
- **Other devices of the recorder get a replacement push.** "You gave <Person>'s <medication> at <time>" on the same tag, to the recorder's Account only. The save request names the recording device with an `x-fc-push-endpoint` header so it is skipped; the endpoint is used only to choose recipients and is never stored or logged. If the device is unknown, every device of the recorder gets it. This push is not silent. Someone else recording keeps "<name> gave…".
- **What clears a dose reminder.** Only a dose that attaches to its slot (On time, or answered Late or Early). A PRN, unscheduled or extra dose, and a dose still waiting for its answer, do not, even if saving it also settled a slot of that medication as Missed, so an extra dose cannot hide a dose that is still due. The decision is returned as data (`decideDoseNotification`) so tests send no real push.
- **Hydration.** After a Hydration reading is saved, pacing is recomputed with the existing calculation. Caught up (on pace, or goal met) clears; still behind updates the same notification to the new count; muted today sends nothing. A change applies only to a nudge that is actually outstanding: one went out in the last 24 hours and no reading has come since. A reading with nothing outstanding never creates a notification. The recording device closes or updates its own copy by tag and never creates one; other devices receive a quiet replacement on the same tag (`silent: true`, no new sound or vibration), without a notification log row. Recipients stay the linked Account only.
- **"Caught up" is shown briefly, then closed.** Because a push must show something, the clear is a quiet "Caught up" notification with `closeAfterMs` (four seconds, capped at ten in the service worker), which the service worker closes after the wait.
- **Dose expectations.** Answering Given or Not given closes the question on the answering device only. No push is sent to clear it elsewhere.

## Consequences

- **A slot that times out in cron leaves its reminder on screen** until it is dismissed or replaced, because no device is recording and a push cannot clear remotely. Missed raises no push of its own (ADR-0029).
- Platform behaviour for silent replacement, the brief "Caught up" and `getNotifications` from an installed PWA differs between devices, so it is checked by hand on a real phone and a second device (the 1.1.0 validation checklist), not by tests.
- Per-class and per-channel notification preferences belong to the later Notifications release, not here.

## References

- ADR-0017 (one question push per expectation-day), ADR-0029 (what makes a slot Missed)
- `lib/push/dose-notification-decision.ts`, `lib/hydration/hydration-notification.ts`, `lib/push/notification-client.ts`, `public/sw-push.js`
