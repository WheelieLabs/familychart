# ADR-0027: Permanent Account removal pseudonymises the actor and tombstones Entra

**Status:** Accepted

## Context

Deactivating an Account blocks sign-in and keeps the row, the credentials and the email on every audit and record line. That is the reversible choice. A household also needs a way to drop an Account that should not come back: a local password, an authenticator secret, invite tokens, push subscriptions and the email used as the actor on history. Person erase already hard-deletes one Person and leaves the Account. Removing the Account must not delete Person records, and it must not leave a table that maps the replacement token back to the old email.

Entra sign-in creates an Account when someone in the group has none. Deleting the row alone would recreate it on the next sign-in.

## Decision

- **Who.** An Admin removes any Account other than their own. An Account holder removes their own after a fresh sign-in: the local password (and authenticator code when one is enrolled), or an Entra interactive sign-in whose id_token `auth_time` is within five minutes ([ADR-0016](0016-app-lock-device-bound-credential.md); a missing claim refuses). The demo refuses removal. Removal is refused while a Person is still linked (unlink first, or erase the Person). The link check and the last-local-Admin check run inside the removal transaction, and the Person row is left unchanged.
- **Last local Admin.** The same check the edit-Account route already uses (`isLastLocalAdmin`) also refuses permanent removal. It counts only active local Accounts with the Admin role (`is_active = 1`), so a disabled Admin does not stand in for the last active one; a pending Invite does not count either, because nobody can sign in with it yet. This matches [ADR-0022](0022-none-household-role.md). Entra-backed Accounts are neither counted nor blocked. The announced reason stays "Cannot remove the last local Admin".
- **One transaction, in this order.** Count the rows that will be rewritten. Delete push subscriptions, Favourites, per-user settings, notification preferences and notification log rows for that Account. Leave the Person row, including its Personal-link, because a linked Account is refused before any of those deletes. Delete the Entra revalidation row. For an Entra Account, store a tombstone of the SHA-256 hash of the object id and nothing else. Rewrite `audit_log.user_email` and every `created_by` text column that holds the removed email to one random token (`removed:` plus 32 random bytes, base64url). Delete the Account row, which takes the password, the reset flag, the MFA secret, the session version and any invite token with it. Sessions are JWTs; the next request finds no Account and is signed out. Then write one `DELETE` / `accounts` audit row, `{ event: "Account removed", counts }`, with the removing Admin (or the token, when the holder removes their own) and no removed email in `details`. Audit `details` on older rows are left as they are. One `account_removed` container-log line records the same counts.
- **Display.** The token is stored only in the rows it replaces. There is no lookup table. The audit log and any other screen that shows an actor renders "Removed account". Export files keep the token. An export already held, and an operator backup, are not rewritten.
- **Entra.** The sign-in path checks the tombstone before it matches or creates an Account. A person still in the group sees a signed-out page, "Your account was removed", and is not given a new Account. An Admin action, "Allow this person back", deletes that hash. The list shows the removal time and the label, not an email or a name.
- **Person erase.** The erase confirmation offers "Also permanently remove their Account" for a linked Account and runs this removal as the last step of the same erase, only when the caller sends `remove_account: true` and the last-local-Admin check does not block. When the Account is the caller's own (an Admin erasing the Person linked to their own Account), the caller first gives the same fresh proof as the holder path; `isOwnAccount` is the one check shared with the Admin removal route. The switch defaults on for Household Role None and off for an Account with a role. When the guard blocks it, the switch is disabled with the reason and the previous outcome stands.
- **Restore.** A removed email is treated like any email with no Account: an Admin may invite it again, and that invite has none of the old rows. Record and audit text that already holds the token stays the token. A household file that carries an Entra object id whose hash is tombstoned is skipped, and the preview says "removed on this instance; allow them back first".

## Consequences

- Older audit `details` may still contain the email. Person erase is what blanks health content.
- A backup or an export taken before the removal can still contain the email. Restoring that backup brings the Account back; the tombstone returns only when the backup included it.
- Household exports do not add an Entra object id. The restore skip applies when a file already has `external_id`.
- No new environment variable.
