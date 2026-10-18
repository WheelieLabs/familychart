// SPDX-License-Identifier: AGPL-3.0-only

import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import Button from "@/components/ui/Button"
import EmptyState, { EMPTY_STATE_ICONS } from "@/components/ui/EmptyState"
import PageContainer from "@/components/ui/PageContainer"
import type { Metadata } from "next"

export const metadata: Metadata = { title: "Account Removed" }

export default function AccountRemovedPage() {
  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Account Removed" />
      <PageContainer>
        <EmptyState
          icon={EMPTY_STATE_ICONS.accessDenied}
          heading="Your account was removed"
          action={<Button href="/login">Back to sign in</Button>}
        >
          An administrator removed your account on this instance. You can sign in again only after an administrator allows you back.
        </EmptyState>
      </PageContainer>
      <AppFooter />
    </div>
  )
}
