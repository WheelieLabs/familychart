# ADR-0025: Person erase is a hard delete with audit content blanked

**Status:** Accepted — engine and confirmation screen implemented

## Context

Routine deletes only set `is_active`. That hides a Person and keeps every dose, observation, file and audit detail, which is not a deletion of personal data. Most `person_id` foreign keys have no cascade, so removing a Person has to name every dependent table. The audit log has to keep a security trail without keeping the record content, and an export that is still streaming must not be cut off. Backups live outside the app and cannot be rewritten from here.

## Decision

- **One Person, hard delete.** `POST /api/people/[id]/erase` deletes that Person's doses, observations, test results and values, symptoms and links, assignments and schedules, goals, expectations, dose expectations with exceptions and outcomes, slot outcomes (deleted explicitly and counted, not left to the cascades), Favourites, notification preferences, notification history and the matching push dedupe rows, then the Person. Shared catalogue rows (medications, observation types, test metrics) stay. There is no tombstone and no undo inside the app.
- **Who.** An Admin, and only for a Person who is already deactivated. An Account with a Personal-link, for its own Person only, whether or not that Person is still active, after a fresh sign-in: the local password (and authenticator code when one is enrolled), or an Entra interactive sign-in whose id_token `auth_time` is within five minutes ([ADR-0016](0016-app-lock-device-bound-credential.md); a missing claim refuses). Anyone else receives 404. The demo refuses erase. A Personal-link makes its holder the Person's owner here and for export, so only an Admin may create, move or clear one through the people routes (a Manager's request that changes `account_uid` is refused with 403); links made by the invite and Account lifecycle are unaffected.
- **Order.** Authorise once and remember the actor's email. Refuse while an export of that Person is in flight. One database transaction. Delete the photo and report files after the commit; a file that fails is logged and named in the result, and the database change stands. Build the result, then deactivate a linked None-role Account and bump its session version. An Account with a Household Role is left signed in, and the result says so. A failure of that sign-out does not hide the result.
- **Audit.** Collect the Person's record ids first. Clear `details` on every audit row about that Person or those records, and keep the actor, action, table and time. Then write one `ERASE` row with the actor, the time and the counts, and no name or date of birth.
- **Backups.** Erase does not touch them. Restoring a backup taken earlier can bring the Person back; the result says to erase them again. No list of erased people is stored, because a restore of the data directory would roll a sidecar back too.
- **Log.** One `person_erased` line: the actor's role, the counts, how many files failed, and the Account outcome. Not the name, date of birth, email or record text.

## Consequences

- A Person who is only deactivated is still in the database and can be exported. Erase is the step that removes them.
- The in-flight count is process-local, same as the export registry.
- The confirmation screen lives on Data Export & Restore for an Admin and on Profile for a Personal-link: it shows the counts, asks for the Person's name, offers an export first and states that backups may still contain the Person. It can also permanently remove a linked Account, through the same removal as an Admin removing an Account. That option defaults on for Household Role None and off for an Account with a role. When the last-local-Admin guard blocks it, the option is disabled with that reason and the existing outcome applies: a None-role Account is deactivated, and an Account with a role is kept.
- No new environment variable.
