// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import ErasePersonConfirm from "@/components/ErasePersonConfirm"
import PageContainer from "@/components/ui/PageContainer"
import { administrationTrail } from "@/lib/ui/breadcrumbs"

export default function ErasePersonPage({ personId }: { personId: string }) {
  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Erase Person" />
      <PageContainer
        area="admin"
        trail={administrationTrail(
          { label: "Data Export & Restore", href: "/admin/export" },
          { label: "Erase Person" },
        )}
      >
        <ErasePersonConfirm personId={Number(personId)} mode="admin" />
      </PageContainer>
      <AppFooter />
    </div>
  )
}
