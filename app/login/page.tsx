// SPDX-License-Identifier: AGPL-3.0-only

import { Suspense } from "react"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import LoginForm from "./LoginForm"
import { getDb } from "@/lib/db"
import { isMfaRequiredPolicyActive } from "@/lib/account/account-local-reauth"
import { isEntraProviderActive } from "@/lib/settings/auth-settings"
import type { Metadata } from "next"

export const metadata: Metadata = { title: "Sign In" }

export const dynamic = "force-dynamic"

export default function LoginPage() {
  const db = getDb()
  const enableEntra = isEntraProviderActive(db)
  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="FamilyChart" minimal />
      <Suspense fallback={null}>
        <LoginForm
          enableEntra={enableEntra}
          enableCredentials
          mfaRequired={isMfaRequiredPolicyActive(db)}
        />
      </Suspense>
      <AppFooter />
    </div>
  )
}
