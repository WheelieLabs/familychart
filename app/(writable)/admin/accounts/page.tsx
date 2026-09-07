// SPDX-License-Identifier: AGPL-3.0-only

import { getDb } from "@/lib/db"
import { isOutboundEmailConfigured } from "@/lib/email-send"
import { isEntraProviderActive } from "@/lib/settings/auth-settings"
import AccountsAdminClient from "./AccountsAdminClient"

export default function AdminAccountsPage() {
  const db = getDb()
  return (
    <AccountsAdminClient
      entraActive={isEntraProviderActive(db)}
      emailConfigured={isOutboundEmailConfigured(db)}
    />
  )
}
