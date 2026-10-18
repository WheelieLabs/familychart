# ADR-0017: Dose expectations — derived pending state, confirmed at the slot time

**Status:** Accepted (decided 2026-10-03); implemented

## Context

Some doses are routinely given away from home at a known time, such as a midday dose at school during term. Without a way to *expect* that, a genuinely missed dose and a dose nobody logged look identical, and the home screen raises a red "overdue" alert for a dose that was never meant to be given there.

## Decision

- A **Dose expectation** is scoped to one Scheduled slot, addressed as `(person_medication_id, slot_hhmm)` (the same slot addressing the retired reminder cancellation used). Its recurrence is a parent-entered date range, an optional weekday filter, and one-off exception days. Term dates are never read from an external calendar.
- **Pending is derived, never stored.** An expectation is pending when it applies today, the slot time has passed, no outcome is recorded for the day, it is not snoozed, and no dose is already logged near the slot. Only *outcomes* are stored (`confirmed_given`, `confirmed_missed`, `snoozed`), so there are no rows to generate or expire. A prompt lasts to the end of its local day.
- **The normal alert is replaced, not added to.** Alert readiness leaves an external slot out of the normal slots, so the red overdue alert and its push do not fire; the amber pending prompt takes its place.
- **"Given" records a real dose at the slot time**, tagged `away_from_home`, through the same write path as every other dose (`recordDose`). The slot time is the best known time and stays stable however late the parent answers; recording at the moment of the tap would make a noon dose look like a mid-afternoon one and could wrongly clear a cooldown or cap window. The record can still be edited in History.
- A one-off exception day turns that slot back into an ordinary home slot for that day. An expectation only applies while the slot still exists and the medication's own schedule runs that day; if the slot time is edited out of the schedule, the expectation goes quiet.
- **Only today's dose can be answered**, in the schedule's own timezone; the client never chooses the day.
- **"Missed" is history only:** no dose record, no alert, no effect on any safety check. (From 1.1.0 a "Not given" answer also stores a Missed slot outcome, so there is one Missed state; see [ADR-0029](0029-dose-timing-and-missed.md). Everything else here stands.) A miss is an undertreatment concern and out of scope; only a given-but-unlogged dose is an overdose risk.
- **"Not yet" snoozes** the prompt for one hour.
- **One push per expectation-day.** Cron sends a neutral "was it given away from home?" push (scheduled-reminder preference, deduped by expectation and day) for each pending expectation, only while the slot is under three hours old so a restart or outage never pushes about an old dose. It uses its own notification tag, so it does not replace a dose reminder for the same medication. It replaces the home reminder that is left out; a "Not yet" snooze brings the in-app prompt back but does not push again.
- **A confirmed miss shows in History** as a `dose_missed` feed row (no flag, no edit) under the Medication filter and calendar dot. It is a separate feed kind, not a medication record, so it still affects no safety check. Outcomes store `slot_at` so it sits on the dose time.
- Pending prompts are resolved **inline** (flat Yes / No / Not yet buttons extending the Hydration "mute today" row) and shown as a **soft interrupt** on Record Medication, which never blocks the entry (ADR-0011).

## Consequences

- Deleting an expectation deletes its outcomes (cascade), including recorded misses. Removing a term is a deliberate edit, not a routine action.
- The Medication timeline and alerts need no changes: a confirmed dose is an ordinary record.
