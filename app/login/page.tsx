// SPDX-License-Identifier: AGPL-3.0-only

import { Suspense } from "react"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import LoginForm from "./LoginForm"
import { getDb } from "@/lib/db"
import { isEntraProviderActive } from "@/lib/settings/auth-settings"

export const dynamic = "force-dynamic"

export default function LoginPage() {
  const enableEntra = isEntraProviderActive(getDb())
  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="FamilyChart" minimal />
      <Suspense fallback={null}>
        <LoginForm
          enableEntra={enableEntra}
          enableCredentials
        />
      </Suspense>
      <AppFooter />
    </div>
  )
}
