# What's New

User-facing release notes for the in-app **What's New** screen.

Add a version section only when something visible or meaningfully different for carers and family users. Technical and internal changes belong in `CHANGELOG.md` only.

Promote `## [Unreleased]` into `## [N]` on the **same commit** (or an earlier commit) as the `package.json` bump to N — never after that version has been built and deployed. The in-app modal is generated at image build from this file; a bump without a matching `## [N]` heading ships an empty What's New list. First login after such a deploy records `last_seen_version = N` with nothing shown, so those accounts will not see N's notes later.

Versions before 1.0.0 were internal development releases, not public installs — their individual entries have been consolidated into the welcome message below so upgraders don't see 40+ dev-cycle notes on first login post-launch. Full history remains in `git log -- WHATS_NEW.md` and `CHANGELOG.md` for maintainers.

---

## [Unreleased]

## [1.0.4] - 2026-09-12

- Fixes biometric unlock getting permanently stuck for some users after changing their device's lock screen or re-enrolling a fingerprint/face — you can now reset and re-register biometric unlock right from the lock screen

## [1.0.3] - 2026-09-12

- Further reliability improvements for biometric unlock

## [1.0.2] - 2026-09-11

- Improves reliability of biometric unlock behaviour
- Introduces additional medication schedule frequency options

## [1.0.0] - 2026-08-03

- Welcome to FamilyChart! Track medications and health observations for everyone in your family, with push reminders so scheduled doses and check-ins don't get missed.
- Sign in your way — Microsoft or local accounts, two-factor authentication, and biometric app lock (Face ID / Touch ID) per signed-in account on a shared device.
- Admins get full household management: schedules and goals, spreadsheet import, an audit log, and per-person data export.
- Admins invite people to sign in by email from **Administration → Accounts**, and can link or create a Person at invite time.
