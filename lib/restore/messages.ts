// SPDX-License-Identifier: AGPL-3.0-only

/** An export made before restore existed has no manifest. */
export const EXPORT_PREDATES_RESTORE =
  "this export predates restore support; export again from an updated FamilyChart"

/** A format version this importer does not know. `version` is the producing app version. */
export function newerExportMessage(appVersion: string): string {
  return `this export comes from a newer FamilyChart (version ${appVersion}); update before importing`
}

export const NOT_AN_EXPORT = "This file is not a FamilyChart export"

export const WRONG_EXPORT_PASSPHRASE = "That passphrase doesn't open this file"

export const DAMAGED_EXPORT = "This file is damaged or incomplete"

/** The zip's directory or an entry header points outside the file, or needs zip64. */
export const ARCHIVE_STRUCTURE_INVALID = "This file's archive structure is invalid"

/** An entry inflates past its cap or past the size the archive declared for it. */
export const ENTRY_TOO_LARGE = "This file contains an entry that is too large to restore"

export const UNSUPPORTED_EXPORT_ENCRYPTION = "This file uses an encryption option FamilyChart cannot open."

export const DEMO_RESTORE_DISABLED = "This is a demo environment — restore is disabled."

export const ACCOUNTS_SKIPPED_NO_EMAIL =
  "Accounts will not be restored: outbound email isn't configured. Set it up in System Settings, then run this restore again to add them."

/** Person restore left the Sign-in field blank, so that Person's settings were not written. */
export const PERSONAL_SETTINGS_NOT_CARRIED =
  "personal settings not carried: no sign-in given"

export const SIGN_IN_ALREADY_LINKED =
  "This account already has a Personal-link to someone else."

export const SIGN_IN_PERSON_ALREADY_LINKED =
  "This Person already has a Personal-link."

export const INVITE_CREATED_UNSENT =
  "The invite was created but not sent. Send it later from Administration → Accounts."

/** Entra and local sign-in are both available; the restored Account is a normal pending Invite. */
export const ENTRA_ALSO_NOTE =
  "This instance also uses Entra sign-in — they can set a password from the invite, or sign in with Entra using the same email."
