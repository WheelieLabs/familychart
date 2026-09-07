// SPDX-License-Identifier: AGPL-3.0-only

import { Suspense } from "react"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import AcceptInviteForm from "./AcceptInviteForm"
import { getDb } from "@/lib/db"
import { resolveSetting } from "@/lib/settings/resolver"
import { SETTING_SECURITY_PASSWORD_MIN_LENGTH } from "@/lib/settings/registry"

export const dynamic = "force-dynamic"

export default function AcceptInvitePage() {
  const passwordMinLength = parseInt(
    resolveSetting(getDb(), SETTING_SECURITY_PASSWORD_MIN_LENGTH).value,
    10,
  )
  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="FamilyChart" minimal />
      <Suspense fallback={null}>
        <AcceptInviteForm passwordMinLength={passwordMinLength} />
      </Suspense>
      <AppFooter />
    </div>
  )
}
