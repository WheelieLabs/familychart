// SPDX-License-Identifier: AGPL-3.0-only
"use client"

import { useEffect } from "react"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import Button from "@/components/ui/Button"
import EmptyState, { EMPTY_STATE_ICONS } from "@/components/ui/EmptyState"
import PageContainer from "@/components/ui/PageContainer"

/**
 * The page shown when something unexpected throws while rendering, so a person never lands on the
 * framework's default error page. Used by `error.tsx` and `global-error.tsx`.
 */
export default function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
    document.title = "Error · FamilyChart"
  }, [error])

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Error" />
      <PageContainer>
        <EmptyState
          icon={EMPTY_STATE_ICONS.error}
          heading="Something went wrong"
          action={
            <>
              <Button onClick={reset}>Try again</Button>
              <Button href="/" variant="secondary">Go Home</Button>
            </>
          }
        >
          We couldn&apos;t load this page. Try again, or go home if it keeps happening.
        </EmptyState>
      </PageContainer>
      <AppFooter />
    </div>
  )
}
