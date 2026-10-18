# ADR-0029: Dose timing is stored per slot, and Missed is information, never an alert

**Status:** Accepted — implemented in 1.1.0

## Context

A dose for a scheduled medication used to be matched to a slot at display time, by pairing it with any slot within a fixed 60 minutes (later a setting, the History association radius). Three problems followed:

- The pairing was recomputed on every read, so editing a schedule could relabel old History.
- An early dose could only be handled by ticking "cancel the next slot" on Record Medication, which hid the slot instead of answering it, and the cancellation lived in its own table that cron, Alert readiness and the timeline all had to read.
- A dose nobody gave left no trace: the slot simply stopped being shown.

FamilyChart is a record-keeping application (ADR-0011). Timing has to describe what happened without ever deciding whether a dose may be recorded.

## Decision

- **Slot outcomes store.** A `slot_outcomes` table, keyed by `(person_medication_id, local_ymd, slot_hhmm)` with the day on the Schedule clock, holds what happened to a Scheduled slot. A row exists only once a dose attaches or the slot is Missed, so a label never changes when the schedule is edited later. It is separate from `dose_expectation_outcomes` (ADR-0017), which is not migrated into it. Deleting an attached dose deletes its row and so reopens the slot.
- **Results.** `on_time`, `early`, `late`, `missed` and `given`. `given` is a fifth value the spec did not list: a Dose expectation answered Given attaches a dose at the slot time with no timing label, so it can be neither On time nor Late, and a separate value keeps it from being shown as a timing exception. `offset_minutes` is slot to dose (negative when early) and is null for `missed` and `given`. A Missed row also records its cause: `timed_out`, `not_given` or `early_answer`.
- **The On time window is fixed at 10 minutes either side of a slot** (`ON_TIME_WINDOW_MS`). It is not a setting: there is no number for an operator to get wrong. A dose inside the window of a slot that already holds a dose is stored as an extra dose without a prompt.
- **One write path.** `recordDose` classifies the dose in the same transaction that inserts it. On time attaches silently. A dose outside every window comes back as `needs_prompt` data (the earlier open slot, the later open slot, and the slots an Early answer would mark Missed), and nothing is stored until it is answered. An unscheduled medication (PRN or no schedule) is never classified and never prompted.
- **The prompt answers the question after the dose is saved.** Late attaches to the nearest earlier slot with no dose, Early to the nearest later one and marks every earlier open slot Missed straight away, Extra stores nothing. No answer behaves exactly like Extra and leaves slot and alert state alone, so ignoring the prompt never loses a dose. The prompt never blocks the save (ADR-0011). The server recomputes the slots from the stored dose when the answer arrives, so the client never names a slot (`POST /api/records/[id]/timing`).
- **"Cancel the next slot" is removed**, with its Record Medication checkbox, the request option, the suppressed slot state, every read of the suppressions table, and the table itself (dropped by migration). An early dose is now attached to the next slot by answering Early. The History association radius setting and its environment variable are retired with it: a stored value is deleted by the same migration and the environment variable is no longer read. The lead and overdue offsets stay, so alert and push timing are unchanged.
- **Missed.** A slot is open until the next slot starts, or until the end of its Calendar day if it is the last. With no dose attached by then it becomes Missed (`settleSlots`, called from the dose write path for that Person and from cron for everyone). A Late answer or an On time dose can still replace a `timed_out` Missed row; nothing replaces a slot that holds a dose. `settleSlots` ignores slots from before the store existed, so upgrading does not mark already-given doses Missed.
- **A schedule starts from the next dose.** A schedule created part-way through its start day keeps the instant it was created (`person_medications.schedule_created_at_ms`, migration `034`), and a slot earlier that day, before that instant, is not an expectation: it is never overdue, never settled as Missed, never reminded and never on the timeline. The rule is one shared check (`isSlotBeforeScheduleCreation`) used by every slot walker. It concerns only the start day when that is also the creation day: a backdated start date keeps its slots, a row with no recorded instant has no boundary, edits never move it, and only a schedule that starts running (none before, or reactivated by adding the medication again) is stamped. The instant travels in the Person export as an optional assignment field with no format version change.
- **Dose expectation slots never time out.** They resolve only by answer. Given attaches the dose as `given`; Not given makes the slot Missed at once (`not_given`), so there is one Missed state, not two. ADR-0017's "history only" for a confirmed miss now means this row; older answers still list through the same History feed row.
- **Missed is information, never an alert.** It raises no alert and no push, is not counted in the status, never blocks a dose, and has no effect on any safety check (ADR-0011, ADR-0017). The person page shows it as a quiet informational line that drops off when the Calendar day it became Missed ends. History shows a red-edged row with a "Missed" badge; the medication timeline draws a cross.
- **History marks only exceptions.** A Late or Early dose carries a badge saying by how much ("41 min late"); On time is unmarked; an attached dose reads "Taken <time> · for the <slot> dose". `GET /api/records` carries `timing`, and `GET /api/dose-missed` reads Missed slots.
- **Export, restore and erase.** Slot outcomes are a `slot_outcomes` section of the Person and household exports, restored with the doses and removed with the Person (ADR-0028, ADR-0025). Export carries each outcome's settle time (`created_at`) and restore keeps it, so a restored Missed slot does not read as newly Missed on the dashboard; an older export without the section still restores, with no timing labels.

## Interim limits

Known gaps in 1.1.0, recorded so they are not mistaken for bugs:

- A slot that times out in cron is marked Missed but no push can reach a device to remove its reminder; see ADR-0030.
- The timeline overdue marker no longer carries the old amber Late flag, because lateness now comes from the stored outcome.
- Missed settling ignores any slot before the store existed on that instance (the time migration `030` was applied), so on an instance upgraded or freshly provisioned today, yesterday's uncovered slots are never settled as Missed.
- A past slot with no stored outcome still reads Overdue until cron settles it. This matters mainly just after the upgrade, and for a slot from before the store existed, which is never settled.
- A dose recorded before the upgrade has no slot outcome, so it carries no timing label. A dose restored from an export that has no `slot_outcomes` section is the same.
- The Early line "marks earlier open doses as missed" is shown only when it would be true, and the prompt offers only an earlier or later slot that is actually open.

## Consequences

- Labels are history: changing a schedule never rewrites them, and a slot whose time is edited out simply has no row for the new time.
- Display code reads stored outcomes, not a nearby slot, so History, the timeline and the dashboard cannot disagree.
- Anything that wants a different On time window, a Missed alert, or a gate on recording would reverse this ADR and needs a new one.

## References

- ADR-0011 (alerts are not write gates, including the once-a-day cap amendment), ADR-0017 (Dose expectations), ADR-0028 (export format), ADR-0025 (Person erase)
- `lib/schedule/slot-outcomes.ts`, `lib/medication/record-dose.ts`, `docs/architecture.md` › `slot_outcomes`
