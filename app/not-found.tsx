// SPDX-License-Identifier: AGPL-3.0-only

import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import Button from "@/components/ui/Button"
import EmptyState, { EMPTY_STATE_ICONS } from "@/components/ui/EmptyState"
import PageContainer from "@/components/ui/PageContainer"
import type { Metadata } from "next"

export const metadata: Metadata = { title: "Page Not Found" }

export default function NotFoundPage() {
  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Page Not Found" />
      <PageContainer>
        <EmptyState
          icon={EMPTY_STATE_ICONS.pageNotFound}
          heading="Page not found"
          action={<Button href="/">Go Home</Button>}
        >
          This page doesn&apos;t exist or may have been moved.
        </EmptyState>
      </PageContainer>
      <AppFooter />
    </div>
  )
}
