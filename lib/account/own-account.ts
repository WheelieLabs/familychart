// SPDX-License-Identifier: AGPL-3.0-only

import { parseLocalAccountUid } from "@/lib/account/account-uid"

/**
 * True when the session user is this Account: a local session matches on the Account id, an Entra
 * session on the Account's `external_id`. The one place that decides "their own Account" for every
 * route that removes or protects an Account.
 */
export function isOwnAccount(
  sessionUserId: string | undefined,
  account: { id: number; external_id: string | null },
): boolean {
  const localId = parseLocalAccountUid(sessionUserId)
  if (localId != null) return localId === account.id
  return Boolean(account.external_id && sessionUserId === account.external_id)
}
