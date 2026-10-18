// SPDX-License-Identifier: AGPL-3.0-only

import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import Button from "@/components/ui/Button"
import EmptyState, { EMPTY_STATE_ICONS } from "@/components/ui/EmptyState"
import PageContainer from "@/components/ui/PageContainer"
import type { Metadata } from "next"

export const metadata: Metadata = { title: "Access Denied" }

interface Props { searchParams: Promise<{ reason?: string }> }

export default async function DeniedPage({ searchParams }: Props) {
  const { reason } = await searchParams
  const message = reason === "no-group"
    ? "There is nothing for your account to show. It has no access group, or the family member linked to it is not active. Contact your administrator."
    : "You don't have permission to access this area."

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Access Denied" />
      <PageContainer>
        <EmptyState
          icon={EMPTY_STATE_ICONS.accessDenied}
          heading="Access denied"
          action={reason === "no-group" ? undefined : <Button href="/">Go Home</Button>}
        >
          {message}
        </EmptyState>
      </PageContainer>
      <AppFooter />
    </div>
  )
}
