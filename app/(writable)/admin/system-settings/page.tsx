// SPDX-License-Identifier: AGPL-3.0-only

import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import RegistrySettingsPanel from "@/components/RegistrySettingsPanel"
import { mainContentTargetProps } from "@/lib/a11y"

export default function SystemSettingsPage() {
  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="System Settings" />
      <main {...mainContentTargetProps} className="fc-surface-admin fc-scroll p-3 pb-8 flex flex-col gap-3">
        <RegistrySettingsPanel />
      </main>
      <AppFooter />
    </div>
  )
}
