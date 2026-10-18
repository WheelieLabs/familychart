// SPDX-License-Identifier: AGPL-3.0-only

import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import RegistrySettingsPanel from "@/components/RegistrySettingsPanel"
import PageContainer from "@/components/ui/PageContainer"
import { administrationTrail } from "@/lib/ui/breadcrumbs"
import type { Metadata } from "next"

export const metadata: Metadata = { title: "System Settings" }

export default function SystemSettingsPage() {
  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="System Settings" />
      <PageContainer area="admin" trail={administrationTrail({ label: "System Settings" })}>
        <RegistrySettingsPanel />
      </PageContainer>
      <AppFooter />
    </div>
  )
}
