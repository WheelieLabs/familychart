// SPDX-License-Identifier: AGPL-3.0-only

import { Suspense } from "react"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import ResetPasswordForm from "./ResetPasswordForm"
import { getDb } from "@/lib/db"
import { resolveSetting } from "@/lib/settings/resolver"
import { SETTING_SECURITY_PASSWORD_MIN_LENGTH } from "@/lib/settings/registry"

export const dynamic = "force-dynamic"

export default function ResetPasswordPage() {
  const passwordMinLength = parseInt(
    resolveSetting(getDb(), SETTING_SECURITY_PASSWORD_MIN_LENGTH).value,
    10,
  )
  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="FamilyChart" minimal />
      <Suspense fallback={null}>
        <ResetPasswordForm passwordMinLength={passwordMinLength} />
      </Suspense>
      <AppFooter />
    </div>
  )
}
