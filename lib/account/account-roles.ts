// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Roles an `accounts` row can hold. Single source of truth for validation, shared by every
 * route that accepts a role on input (local-user create/edit, invite creation) so a future
 * role addition/rename can't drift between copies.
 */
export const VALID_ROLES = new Set(["admin", "manage", "write", "read"])
