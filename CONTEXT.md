# FamilyChart

Household medication and health-observation records for a single instance, with caregiver Accounts distinct from roster People.

## Language

**Account**:
A canonical sign-in identity on this instance — local-password or Entra. Household Role and Person-linking attach here.
_Avoid_: user, local user, login

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
