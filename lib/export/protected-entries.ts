// SPDX-License-Identifier: AGPL-3.0-only

/** Small encrypted entry. A wrong passphrase fails here, before any record is read. */
export const CHECK_ENTRY = "check"

/** Sections, counts and skipped files. Encrypted, immediately after the check entry. */
export const CONTENTS_ENTRY = "contents.json"

/** Plaintext of the check entry. The authentication code, not these bytes, decides a wrong passphrase. */
export const CHECK_TEXT = "ok"
