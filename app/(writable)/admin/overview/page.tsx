// SPDX-License-Identifier: AGPL-3.0-only

import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import EntraRevalidationGapBanner from "@/components/EntraRevalidationGapBanner"
import { HubGrid, HubTile } from "@/components/ui/HubTile"
import PageContainer from "@/components/ui/PageContainer"
import { getEntraRevalidationGap } from "@/lib/auth/entra-revalidation-gap"
import { getDb } from "@/lib/db"
import { isEntraProviderActive } from "@/lib/settings/auth-settings"
import type { Metadata } from "next"

export const metadata: Metadata = { title: "Administration" }

export default function AdminOverviewPage() {
  const db = getDb()
  const entraActive = isEntraProviderActive(db)
  const revalidationGap = getEntraRevalidationGap(db, Date.now())

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Administration" />
      <PageContainer area="admin">
        {revalidationGap && <EntraRevalidationGapBanner gap={revalidationGap} variant="compact" />}
        <HubGrid>
          <HubTile
            href="/admin/accounts"
            icon="🔑"
            title="Accounts"
            description="Invite people to sign in and manage existing accounts"
          />
          {entraActive && (
            <HubTile
              href="/admin/entra-sessions"
              icon="🛡️"
              title="Entra Sessions"
              description="Revoke Microsoft sign-ins instantly"
            />
          )}
          <HubTile
            href="/admin/access-control"
            icon="🔐"
            title="Access Control"
            description="View Entra group membership for this instance"
          />
          <HubTile href="/admin/audit-log" icon="📋" title="Audit Log" description="View full system audit trail" />
          <HubTile href="/admin/system-settings" icon="⚙️" title="System Settings" description="Application configuration" />
          <HubTile
            href="/admin/files"
            icon="📁"
            title="Files"
            description="Household uploads, storage use, and orphan purge"
          />
          <HubTile
            href="/admin/export"
            icon="📦"
            title="Data Export & Restore"
            description="Download a person's full record as CSV, JSON, and photo"
          />
        </HubGrid>
      </PageContainer>
      <AppFooter />
    </div>
  )
}
