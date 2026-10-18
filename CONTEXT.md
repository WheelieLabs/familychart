# FamilyChart

Household medication and health-observation records for a single instance, with caregiver Accounts distinct from roster People.

## Language

**Account**:
A canonical sign-in identity on this instance — local-password or Entra. Household Role and Person-linking attach here.
_Avoid_: user, local user, login

**Sign-in enabled**:
The `is_active` flag on a local Account. When off, the Account is shown as Disabled and cannot sign in. It has no effect on an Entra Account, whose access comes from group membership and revalidation.

**Household Role**:
An Account's place on the instance-wide ladder (ReadOnly, ReadWrite, Manager, Admin), or the absence of one. Absence is not a ladder step; an Account with no household Role must hold a Personal-link, and own-Person access comes from that link.
_Avoid_: No Role (as a rung), Self, user role (when you mean Personal-link)

**Household Reports**:
The instance-wide report-generation capability: other People, whole-family reports, and scheduled delivery. It requires a household Role; it cannot attach to an Account whose household Role is absent.
_Avoid_: Reports role (not a ladder step), self-report

**Self-report**:
On-demand generation of a report whose subject is the Account's Personal-linked Person, including a visit-summary for an appointment of that Person the Account may see. Does not require Household Reports. Offered through the same Reports destination as Household Reports, with the subject locked to that Person.
_Avoid_: self, own-person report (when a carer uses Household Reports on that Person)

**Local Account sign-in**:
The password-and-TOTP check that yields a session bag for an active local Account, or a tagged deny. Missing and inactive Accounts are indistinguishable from a wrong password.
_Avoid_: authorize, credentials provider, login

**Local Account re-auth**:
The authenticated password check (and TOTP when enrolled) that authorises changing that Account's password or authenticator. Distinct from Local Account sign-in.
_Avoid_: step-up, reauthenticate, authorize

**App lock**:
The per-device, per-Account re-verification that hides an already signed-in session after the app is left until the device's owner proves presence. It guards the session; it is not sign-in and grants nothing a session doesn't already have.
_Avoid_: biometric unlock, password manager unlock (user-facing labels, not the concept), lock screen

**App lock grace period**:
The opt-in, per-device span after leaving the app during which returning to the still-running app does not re-lock. A fresh start always locks regardless.
_Avoid_: idle timeout (App lock has none), lock delay

**Person**:
A household-roster individual whose medications and observations are recorded. At most one Account may hold a Personal-link.
_Avoid_: patient, user, profile, resident

**Personal-link**:
The at-most-one Account bound on a Person (`people.account_uid`). That Account may record as the Person and owns shared Person-scoped settings (hydration pacing).
_Avoid_: linked user, own person, self, linked (when you mean Watcher)

**Watcher**:
An Account that follows a Person only through notification prefs, not a Personal-link. A Watcher must not own that Person's shared settings.
_Avoid_: subscriber, follower, linked

**Household export**:
The single zip of every Person together with the shared household configuration (medication catalogue, Accounts as invite descriptors, non-secret instance settings, Favourites).
_Avoid_: backup, bundle, dump

**Person export**:
The standalone zip of one Person, including the configuration that Person uses and no other household data. A Household export embeds one of these per Person.
_Avoid_: backup, bundle, dump

**Restore**:
Applying a Household export or a Person export to this instance. Import Records remains the spreadsheet tool.
_Avoid_: import, migrate

**Erase**:
A hard delete of one Person and the records and files keyed to them. The audit trail is kept, with `details` blanked. Operator backups are left untouched.
_Avoid_: Remove (that deactivates), anonymise

**Invite**:
A pending Account onboarding, bound to an email, with a time-limited opaque token. It is live, expired, or revoked until claimed (local password or Entra) or superseded by resend.
_Avoid_: invitation, onboarding token, reset token

**PRN**:
A medication taken as needed, not on a clock. Frequency rules (cooldown, 24h cap) are caregiver alerts, never a block on recording a dose.
_Avoid_: as-needed (in code and issue titles), PRN gate

**Scheduled slot**:
A planned dose time on a Person-medication schedule for a local calendar day.
_Avoid_: reminder, alarm, dose time

**Dose expectation**:
A parent-defined statement that one Scheduled slot is routinely given away from home (for example a midday dose at school) on the days of a parent-entered term. It replaces that slot's home alert with a question asking whether the dose was given. It is not a reminder and never blocks recording a dose.
_Avoid_: school dose, external dose alert, away-from-home reminder

**Slot outcome**:
What happened to one Scheduled slot on a Calendar day (Schedule clock): the dose that attached to it and how it sat against the slot, or that the slot ended with no dose. Stored once a dose attaches or the slot is Missed, so it never changes when the schedule is edited later. Separate from a Dose expectation's answer. See [ADR-0029](docs/adr/0029-dose-timing-and-missed.md).
_Avoid_: slot status, dose label, suppression

**On time**:
A dose recorded within 10 minutes either side of a Scheduled slot. It attaches to that slot without a question and is not marked in History. The window is fixed, not a setting.
_Avoid_: on schedule, in window

**Late**:
A dose answered "Late" at the prompt: it attaches to the nearest earlier open Scheduled slot, and History says by how much ("41 min late"). A slot already marked Missed by timing out can still take it.
_Avoid_: overdue (that is an alert state, not a Slot outcome)

**Early**:
A dose answered "Early" at the prompt: it attaches to the nearest later open Scheduled slot, History says by how much ("38 min early"), and every earlier open slot becomes Missed straight away.
_Avoid_: pre-dose, cancel the next slot

**Extra dose**:
A dose of a scheduled medication that attaches to no slot: answered "Extra dose", left unanswered, or recorded inside the window of a slot that already has a dose. It is stored like a PRN dose, with no Slot outcome. The prompt never blocks the save.
_Avoid_: unscheduled dose, duplicate

**Missed**:
A Scheduled slot that ended with no dose: the next slot started, its Calendar day ended, an Early answer skipped it, or a Dose expectation was answered "Not given". It is information only: no alert, no push, never blocks a dose. Slots under a Dose expectation never time out into Missed.
_Avoid_: skipped, overdue, missed alert

**Observation expectation**:
A per-Person cadence for recording one catalogue observation type.
_Avoid_: observation reminder, observation schedule

**Live record**:
A record made as the carer does the thing (a dose, an observation, a symptom). Its date and time default to now, and it may be backdated. A "Record X" form for a live record keeps date and time at the top.
_Avoid_: real-time record, instant record

**Retrospective record**:
A record of something that already happened and reached the carer later (a test result, and later an appointment outcome). Its date is required and starts empty, never defaulted to now, and its time of day is not asked.
_Avoid_: late entry, backfill, historic record

**Test result**:
A Person's record of one laboratory or similar test, named by the test's actual name (for example "Iron Studies"), with a Test date, an optional report attachment, and any number of Result values. The attachment is the source of truth; Result values are a transcription of its headline figures.
_Avoid_: test event, test type (the name is the test), lab result, report (that is the attachment)

**Test date**:
The date the test was taken (collected), not the date the result was received or entered. It is never defaulted to today, because results usually arrive days later.
_Avoid_: result date, report date, entry date

**Test metric**:
One measurable quantity in the curated catalogue (for example Haemoglobin), with a default unit, a value type, Metric aliases and a Panel label. Distinct from an observation type, which belongs to the observation catalogue.
_Avoid_: analyte, test type, observation type

**Metric alias**:
An alternative name or abbreviation a laboratory may print for a Test metric ("Hb", "BUN"). It exists for search and for matching report text, and ships with the catalogue.
_Avoid_: synonym, nickname

**Panel**:
A convenience label on Test metrics that mirrors how laboratories and GPs group requests (full blood count, urea and electrolytes). It tells similar metrics apart; it is not a fixed definition of what a laboratory reports.
_Avoid_: test type, category, group

**Other metric**:
A free-text metric name entered when no Test metric fits. Its value type is chosen by the person recording it.
_Avoid_: custom metric, freeform metric

**Limit qualifier**:
The "<", "<=", ">" or ">=" a laboratory prints with a numeric result when it reports only a bound (for example "< 20"). It is kept beside the number, never folded into it, and is separate from the "differs from expected" flag.
_Avoid_: censored value, operator, prefix

**Calendar day**:
The Household-clock date an instant falls on. An Open symptom's span uses these days. A dose is placed on this day, and its label stays the Schedule clock's wall time.
_Avoid_: schedule day, viewer's day

**Household clock**:
The instance timezone. A medication schedule or Observation expectation with no timezone of its own uses this clock.
_Avoid_: device timezone, phone timezone, hydration clock

**Schedule clock**:
The timezone stored on a medication schedule or an Observation expectation. Its wall time is the number on that record and on the timeline, and its day is decided on this clock. When unset, it is the Household clock.
_Avoid_: device timezone, viewer's time

**Viewer's time**:
The same instant shown in the viewer's zone, beside the Schedule clock's wall time, when the two zones differ. It is not stored and it does not decide the day.
_Avoid_: schedule clock, household clock

**Hydration clock**:
An Account's timezone for hydration reminders, daily totals, and mute expiry. When unset, it is the Household clock. It does not decide a Person's calendar day.
_Avoid_: display timezone, schedule clock

**Alert readiness**:
The caregiver-facing alert state for a Person at an instant: due or overdue Scheduled slots, PRN flags, overdue Observation expectations. Not permission to write a dose.
_Avoid_: dashboard status, push notification, write gate

**Open symptom**:
A symptom that is unresolved and has no end date. It is assumed to be continuing until someone says otherwise, and a Person with one is asked once a day whether it is still continuing or resolved.
_Avoid_: active symptom, ongoing symptom (when you mean the state, not an answer to the daily question)

**Notice**:
A Person's dashboard state between amber and green: nothing needs care attention, but something wants a quick confirmation (today, an Open symptom). It never outranks red or amber and is never shown as all clear.
_Avoid_: info, informational, grey status

**Area**:
One of the three parts of the app, each with its own Canvas identity: the user Area (home, people, History, the Record forms), the management Area and the admin Area. Structure is shared across Areas; identity is not.
_Avoid_: section, zone, mode

**Canvas**:
The page background colour of an Area. It is dark, so text on it uses the on-brand text tokens.
_Avoid_: background, theme, page colour

**Card**:
A solid, dark list item sitting on a dark Canvas, with no transparency.
_Avoid_: panel, tile (except a hub tile, which is a Card), row

**Banner**:
The light container for forms, notices and modals, on the `surface-panel` colour. Its kinds (info, warning, error, success) carry an icon and a lead word so meaning never relies on colour.
_Avoid_: alert, toast, panel (a Panel is a laboratory grouping of Test metrics)
