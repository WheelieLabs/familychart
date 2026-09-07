# FamilyChart

Household medication and health-observation records for a single instance, with caregiver Accounts distinct from roster People.

## Language

**Account**:
A canonical sign-in identity on this instance — local-password or Entra. Role and Person-linking attach here.
_Avoid_: user, local user, login

**Local Account sign-in**:
The password-and-TOTP check that yields a session bag for an active local Account, or a tagged deny. Missing and inactive Accounts are indistinguishable from a wrong password.
_Avoid_: authorize, credentials provider, login

**Local Account re-auth**:
The authenticated password check (and TOTP when enrolled) that authorises changing that Account's password or authenticator. Distinct from Local Account sign-in.
_Avoid_: step-up, reauthenticate, authorize

**Person**:
A household-roster individual whose medications and observations are recorded. At most one Account may hold a Personal-link.
_Avoid_: patient, user, profile, resident

**Personal-link**:
The at-most-one Account bound on a Person (`people.account_uid`). That Account may record as the Person and owns shared Person-scoped settings (hydration pacing).
_Avoid_: linked user, own person, self, linked (when you mean Watcher)

**Watcher**:
An Account that follows a Person only through notification prefs, not a Personal-link. A Watcher must not own that Person's shared settings.
_Avoid_: subscriber, follower, linked

**Invite**:
A pending Account onboarding, bound to an email, with a time-limited opaque token. It is live, expired, or revoked until claimed (local password or Entra) or superseded by resend.
_Avoid_: invitation, onboarding token, reset token

**PRN**:
A medication taken as needed, not on a clock. Frequency rules (cooldown, 24h cap) are caregiver alerts, never a block on recording a dose.
_Avoid_: as-needed (in code and issue titles), PRN gate

**Scheduled slot**:
A planned dose time on a Person-medication schedule for a local calendar day.
_Avoid_: reminder, alarm, dose time

**Observation expectation**:
A per-Person cadence for recording one catalogue observation type.
_Avoid_: observation reminder, observation schedule

**Alert readiness**:
The caregiver-facing alert state for a Person at an instant: due or overdue Scheduled slots, PRN flags, overdue Observation expectations. Not permission to write a dose.
_Avoid_: dashboard status, push notification, write gate
