# ADR-0026: Household export and restore are versioned and forwards-only

**Status:** Accepted — documented for 1.1.0; the Household export and restore are not built yet. The Person export is ([ADR-0028](0028-export-format.md)).

## Context

A household has to be able to leave an instance: move to another FamilyChart, self-hosted or managed, or take one Person with them. The only portable file is an export. Once a family holds one, the format is expensive to break, and an importer that quietly drops a section (test results, for example) would look like a successful restore.

[ADR-0028](0028-export-format.md) is the zip contract: `manifest.json` first, an integer format version, JSON as the source of truth, bundle-local ids, neutral entry names, a streamed builder, and who may export one Person. This record is what a Household export contains, how restore applies either scope, and where erase meets an export. It does not change the zip contract.

## Decision

### Forwards-only compatibility

A newer FamilyChart restores an export from an older one. An older FamilyChart is not expected to restore a newer export. The manifest's integer `format_version` rises whenever a section is added, and the manifest also carries the producing app version. An importer accepts any version it knows and refuses a higher one, naming that app version. A file with no manifest — an export from before restore existed — is refused, with a message to export again from an updated FamilyChart.

Optional sections marked required or optional were rejected. An older importer could then restore people and doses and silently drop test results. Encryption, when it exists, stays a container property and does not change the version ([ADR-0028](0028-export-format.md)).

### Two scopes, one importer

A **Person export** is a standalone zip: its own manifest (`scope` `person`), the configuration that Person uses, and no other household data. A **Household export** (`scope` `household`) holds the shared household configuration plus one Person-shaped payload per Person, each in the Person export's shape. One restore screen reads `scope` and accepts either file.

### JSON is the source of truth

The importer reads only the JSON. `household.json` is the shared configuration. Each Person's `person.json` is that Person's history and the configuration they use ([ADR-0028](0028-export-format.md)). Cross-references are bundle-local ids. The app's database ids travel as informational `db_id` fields and are never used to restore, because a restore mints new ids. The CSV copies are for people to read and are never imported.

### Contents

Everything is included with its `is_active` value, including inactive Persons, medications and observation types.

Configuration is included. The shared catalogue covers medications, groups and frequency rules. Each Person payload covers that Person's assignments with schedules, observation goals and expectations, dose expectations with their exceptions and outcomes, and slot outcomes (what happened to each Scheduled slot).

Curated catalogues (observation types, test metrics) are name-and-flag lists only. Their metadata belongs to the app version ([ADR-0012](0012-curated-observation-catalogue.md), [ADR-0019](0019-test-metric-catalogue.md)). Medications are per instance, so they are exported in full.

Accounts travel as credential-free, method-neutral invite descriptors: email, Household Role, Household Reports flag, active flag, the original sign-in method (informational only), and the Personal-link as a reference to the exported Person. Favourites and non-secret, non-platform-locked instance settings are included. Favourites refer to Persons and medications by bundle-local id. Durable per-user preferences travel in `user_settings`, keyed by those same bundle-local Account and Person ids: timezone, hydration pacing and the five notification booleans. A Person export carries only that Person's own settings. The section never contains an email or an Account uid.

Never carried: passwords, MFA secrets, sessions, App lock, push subscriptions, the audit log, transient hydration keys and client-side preferences.

### Layout

`manifest.json` is the first entry. `household.json` follows. Then one directory per Person, `people/<bundle-id>/`, containing that Person's `person.json`, `csv/` and `attachments/` under the neutral names in ADR-0028.

A directory named with the Person's name (`people/<id>-<name-slug>/`) was rejected. ADR-0028 forbids a Person's name in any entry path, and the bundle-local id already stops two people with the same name colliding.

A photo or report that cannot be included is listed in the manifest's `skipped_files` with a reason.

### Attachments

Person photos and the stored, already-redacted test-result report files ([ADR-0021](0021-report-redaction-before-upload.md)). Nothing else on disk. The download says when a file is not encrypted. Passphrase protection is optional, off by default, and does not change the format version ([ADR-0028](0028-export-format.md)). A protected file needs 7-Zip, Keka or WinZip. Entry names and sizes stay visible. A lost passphrase cannot be recovered.

### Restore

One path covers an empty instance and one that already has data. Merge is by mapping. Persons and medications default to New. An exact name and date-of-birth match is pre-selected and shown, including a warning when the dates differ, so a restore can be run again safely. The preview shows name and date of birth side by side. Medications match by name, case-insensitively, and the admin can override the match.

Records are append-only. An exact duplicate is skipped: for a dose, the same Person, medication, time and amount; the equivalent key for each other record type.

Existing configuration wins for frequency rules, schedules and goals. Differences are shown in the preview and not applied. Group membership follows the mapped medication.

Each Person is New, Map to existing, or Skip. Catalogue entries come across only when an imported Person needs them. A None-role Account whose only reason to exist is a skipped Person is skipped, with a note. An Account with a Household Role still arrives, unlinked, when its Person is skipped.

History for a catalogue entry that was later switched off is restored. The restore write path requires catalogue membership but not activity; value, unit and timestamp checks match the normal write path. Exported `is_active` flags are applied by name afterwards. A record whose type or metric is absent from the target catalogue is skipped and listed. Test metrics follow the same rule.

Accounts are created as pending Invites ([ADR-0015](0015-accounts-unification.md)) after the preview, where each Account is ticked on by default. An email that already exists is skipped and never overwritten. An exported row is held to the rules of the interactive invite: a role that is not a FamilyChart role, a Household Reports flag other than 0 or 1, or a None role with no Personal-link in the export is skipped in the preview with the reason and is never created. The target's sign-in configuration decides the method: an Entra email match when Entra is active on the target, otherwise a local password and MFA. The preview names any Account whose method will change. When outbound email is not configured, everything else is restored and only the Accounts step is skipped, with a prompt to configure email and run the restore again. The second run adds what was skipped.

Non-secret, non-platform-locked instance settings and Favourites come across. The target wins, and the difference is visible. Durable per-user preferences are written through the shared user-settings store when the Account is restored. Household restore writes them onto each pending Invite. Hydration pacing is written only when that Person is restored and the Personal-link Account is restored. A skipped Account's settings are skipped. An Account already on the instance with the same email is left unchanged (credential and role), but receives its Favourites and per-user settings additively: a Favourite it lacks is added and one it has is counted as a duplicate, a setting it has not set is filled and one it has is kept, and nothing is overwritten or removed. Its hydration pacing arrives only when the exported Personal-link maps onto the Person that Account is already linked to. The preview says how many Favourites will be added to the existing Account. Existing values are kept; missing keys are filled; a value that fails validation is dropped and counted in the restore summary. A Person export asks for an optional Sign-in for this Person. An email with no Account creates a pending Invite (Household Role None unless the Admin chooses another, with a Personal-link) and sends it, or leaves it unsent when outbound email is not configured. On an Entra instance the invite is claimed by email on first sign-in. An email that matches an Account with no Personal-link is linked and the settings are applied, with no Invite. An Account that already has a Personal-link to someone else is refused for that row. A blank Sign-in carries nothing, and the result says so.

### Execution

The upload is streamed to a temporary file. It is not parsed with `request.formData()`, which would buffer the body. The manifest is read first and an unsupported version is rejected before the preview. The preview is built from that staged file and writes nothing. Apply uses the staged file. All database writes happen in one transaction. Photos and report files are written after the commit; a failure removes the files already written and reports which failed. Invite emails go last, so a failed email leaves the Account pending for resend and does not undo the restore. The staged upload expires after a short window and is deleted after apply.

The zip reader trusts nothing the archive declares. The directory offset and size, each entry's header offset and compressed size, and the entry count (which the directory must be large enough to hold) are checked against the real file size before any allocation. zip64 is not supported and is rejected. Each entry's declared uncompressed size is capped (`manifest.json` 1 MB, `household.json` 16 MB, every other entry at the upload limit), inflation is bounded to the declared size, and the inflated length must equal it. A violation fails the read with a clear restore error ("archive structure invalid" or "entry too large") and never crashes the process.

Restore is Admin-only and blocked in demo mode ([ADR-0005](0005-demo-mode-platform-guard.md)), as Import Records is. It is offered on Data Export & Restore, and on a new instance from setup instead of creating People by hand.

### Access and audit

An Admin may export the household or any Person. Any other Account may export only its own Personal-linked Person ([ADR-0028](0028-export-format.md)). Every export and every restore is audited. A restore writes one summary row (scope, format version, producing app version, counts) plus the ordinary per-row audit entries. Audit details do not carry health values ([ADR-0008](0008-audit-log-coverage.md)).

### Delivery and size

The zip is streamed and attachments are read one at a time; already-compressed files are stored uncompressed ([ADR-0028](0028-export-format.md)). There is no multi-part archive. A Person export is how a household that will not fit in one upload is split.

The restore body limit is `FC_RESTORE_MAX_BYTES`, default `536870912` (512 MiB) for a self-hosted instance. The managed provisioner sets it to about 95 MB, because a managed instance sits behind Cloudflare Free, whose request body limit is 100 MB. The export page warns above 100 MB that a proxy may reject the later upload and that Persons can be exported individually. Operator docs record the variable and that proxy limit when restore ships.

### Erase, where it meets an export

Person erase is a hard delete ([ADR-0025](0025-person-erase.md)). Deactivating a Person is not that delete. Three points meet an export or a restore:

- Erase refuses while an export of that Person is still streaming, using the in-flight count in ADR-0028. A streamed export reads attachments lazily; deleting the files mid-download would truncate the zip.
- Audit rows about that Person or their records are kept, and their `details` are blanked. The erase row records the actor, the time and the counts, with no name or date of birth.
- A Person who is only deactivated can still be exported, and can be reactivated (Manager and above, audited). Reactivate is not an undo of an erase. Erase itself has no undo in the app.

Erase does not touch operator backups. Restoring an older backup can bring an erased Person back.

## Consequences

- Families can move a household or one Person onto any newer FamilyChart. Passwords, MFA, sessions, App lock, push subscriptions and the audit log do not move; people accept an Invite and set those up again. A protected export moves only with its passphrase, which the app does not keep.
- Re-running a restore is safe: mappings default to New except for an exact name and date-of-birth match, and exact duplicate records are skipped.
- A Household export that is larger than `FC_RESTORE_MAX_BYTES` is restored one Person at a time.
- The README, `.env.local.example` and the architecture doc gain the restore route, `FC_RESTORE_MAX_BYTES` and the proxy body-limit note with the restore implementation, not in this record.
- Passphrase-protected exports are optional and do not change the format version ([ADR-0028](0028-export-format.md)).
