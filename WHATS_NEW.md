# What's New

User-facing release notes for the in-app **What's New** screen.

Add a version section only when something visible or meaningfully different for carers and family users. Technical and internal changes belong in `CHANGELOG.md` only.

Promote `## [Unreleased]` into `## [N]` on the **same commit** (or an earlier commit) as the `package.json` bump to N — never after that version has been built and deployed. The in-app modal is generated at image build from this file; a bump without a matching `## [N]` heading ships an empty What's New list. First login after such a deploy records `last_seen_version = N` with nothing shown, so those accounts will not see N's notes later.

An Account sees every section newer than the version it last saw, up to the running version, and a brand-new Account sees none. So this file is a trail of **minor** versions: when a new minor (1.1.0, 1.2.0) is released, delete the previous line's patch sections (for 1.1.0, everything from 1.0.2 to 1.0.12) in the same commit, and fold anything an upgrader still needs to know into the new minor's section first. Patch sections for the current minor stay until the next minor. Full history remains in `git log -- WHATS_NEW.md` and `CHANGELOG.md` for maintainers.

Versions before 1.0.0 were internal development releases, not public installs; their individual entries were consolidated into the welcome message below.

---

## [1.1.4] - 2026-10-30

- Maintenance update: the web framework and code-checking tools are on their latest security and bug-fix releases. Nothing changes in how the app looks or works.

## [1.1.0] - 2026-10-18

- Test results: record a lab or imaging report with the report attached, choose values from a built-in list of about 60 common tests, and chart any value over time against the report's own reference range. A PDF can fill in the values for you to check.
- Reports are covered before they are uploaded. Your phone marks the Medicare number, date of birth, address, phone number and email for covering and you review every page, drawing over anything else. Only the covered copy is kept, never the original.
- Symptoms: record what is happening with a start date, an optional end date and a severity from 1 to 5. A symptom that is still open is asked about once a day, and you can link it to the medication given for it.
- History is now Activity, Calendar and Summaries. A symptom is drawn across every day it lasts, and Summaries covers medications, observations, symptoms and test results.
- Each person's screen shows a medication timeline of the last 24 hours, coloured by whether doses were on time, late or early, with a cross where a dose was never recorded.
- Doses show whether they were on time. Record one at an unscheduled time and a banner asks which dose it was: late, early or an extra dose. Missed never sends an alert or stops you recording.
- Recording a dose clears your reminder, and your other devices say "You gave…" instead of still asking. New schedules start from the next dose.
- Doses given away from home: record who gave a dose, set a school-term schedule and answer Yes, No or Not yet when asked.
- Admins can export, restore and erase a person or the whole household, with an optional passphrase on the file.
- App lock asks you to confirm it's you before it resets or sets up, and has a grace period setting in Profile. Hydration has new quick amounts.

## [1.0.0] - 2026-08-03

- Welcome to FamilyChart! Track medications and health observations for everyone in your family, with push reminders so scheduled doses and check-ins don't get missed.
- Sign in your way — Microsoft or local accounts, two-factor authentication, and biometric app lock (Face ID / Touch ID) per signed-in account on a shared device.
- Admins get full household management: schedules and goals, spreadsheet import, an audit log, and per-person data export.
- Admins invite people to sign in by email from **Administration → Accounts**, and can link or create a Person at invite time.
