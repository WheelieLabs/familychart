# What's New

User-facing release notes for the in-app **What's New** screen.

Add a version section only when something visible or meaningfully different for carers and family users. Technical and internal changes belong in `CHANGELOG.md` only.

Promote `## [Unreleased]` into `## [N]` on the **same commit** (or an earlier commit) as the `package.json` bump to N — never after that version has been built and deployed. The in-app modal is generated at image build from this file; a bump without a matching `## [N]` heading ships an empty What's New list. First login after such a deploy records `last_seen_version = N` with nothing shown, so those accounts will not see N's notes later.

Versions before 1.0.0 were internal development releases, not public installs — their individual entries have been consolidated into the welcome message below so upgraders don't see 40+ dev-cycle notes on first login post-launch. Full history remains in `git log -- WHATS_NEW.md` and `CHANGELOG.md` for maintainers.

---

## [Unreleased]

## [1.0.12] - 2026-10-03

- App lock is faster and more dependable on Android — unlock is now just your fingerprint, face, or screen lock, with no passkey picker. You'll be asked to set App lock up once more on each device
- New "App lock grace period" setting in Profile lets you skip re-locking for 30 seconds, 1 minute or 5 minutes when you switch apps briefly. The default is still to lock immediately
- App lock now stays locked if your connection drops or the server restarts while you're away, and turning it off needs you to confirm it's you again
- Taking or choosing a photo no longer re-locks the app and loses the photo
- Hydration quick amounts are now Mug 250 mL, Can 375 mL, Glass 400 mL and Bottle 600 mL
- A Hydration favourite can now have an amount: tapping it opens the record page with that amount filled in, ready to save

## [1.0.5] - 2026-09-21

- App lock is more reliable on Android — unlock no longer gets stuck repeatedly re-prompting when your phone's password manager briefly takes over the screen mid-unlock
- If unlock does get stuck, the lock screen now tells you to fully close and reopen FamilyChart, instead of a "try again" button that couldn't actually fix it
- We now call this feature "password manager unlock" instead of "biometric unlock" — it's more accurate, since depending on your device and its settings, unlock may use your fingerprint or face, but it can also fall back to your device PIN or pattern

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
