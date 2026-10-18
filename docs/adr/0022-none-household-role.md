# ADR-0022: Household Role None is the sentinel `none`

**Status:** Accepted

## Context

A local Account can sign in with access only to the Person they are Personal-linked to. The demo seed already stores that as `accounts.role = 'none'`. Operators need to assign the same state. Two other shapes were considered: SQL NULL, and a fifth ladder rung called Self.

Household Reports (`can_report` / `local:report`) covers family, other-Person, and scheduled reports. An Account with Role None still needs to generate an on-demand report of their own Personal-linked Person. That is Self-report, not Household Reports.

## Decision

- Persist Role None as `accounts.role = 'none'` (NOT NULL). `VALID_ROLES` includes `none`. Do not store SQL NULL, and do not add a Self rung.
- `localRoleToGroups('none', …)` adds no ladder group and does not add `local:report`, even when a leftover `can_report` flag is set. Saving Role None clears `can_report` in the same update.
- Self-report is the generate-route seam `authoriseReportSubject`: allow the subject when `canReport(groups)` is true and the session may read that Person, or when the subject is the session's Personal-linked Person. Schedule CRUD stays on `canReport()` only.
- Role None requires a Personal-link (invite, edit, and People management must not clear that link). The last active local Admin cannot be demoted or deactivated.

NULL would make a missing role look like a bug. A Self rung would duplicate the Personal-link. Granting `local:report` to None would open family reports.

## Consequences

- `getUserRole` is `null` for a None session. The shell still admits them when a Personal-link exists.
- The Accounts list shows Role None and "Cannot access reports" after the flag is cleared. Self-report does not use that flag.
- A Personal-link Account, whatever its Household Role, may add a bare catalogue medication (name, default dosage, unit) while recording a dose for its own Person (`POST /api/medications` with `person_id`, October 2026). Creating one is a ReadWrite capability by design, and a Personal-link Account already records, assigns and schedules on its own Person, so this adds a creator, not a new exposure. Frequency rules, groups, active flags, variants and the import stay Manager.
- No new environment variable.
