// SPDX-License-Identifier: AGPL-3.0-only

import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import { HubGrid, HubTile } from "@/components/ui/HubTile"
import PageContainer from "@/components/ui/PageContainer"
import type { Metadata } from "next"

export const metadata: Metadata = { title: "Management" }

const TILES = [
  {
    icon: "👥",
    title: "People",
    description: "Manage family members, photos and Entra ID linking",
    href: "/management/people",
  },
  {
    icon: "💊",
    title: "Medications",
    description: "Medication catalogue, groups and frequency rules",
    href: "/management/medications",
  },
  {
    icon: "📥",
    title: "Import Records",
    description: "Import historical records from spreadsheets",
    href: "/management/import",
  },
  {
    icon: "📊",
    title: "Observation Types",
    description: "Show or hide curated observation types for this household",
    href: "/management/observation-types",
  },
]

export default function ManagementPage() {
  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Management" />
      <PageContainer>
        <HubGrid>
          {TILES.map(tile => (
            <HubTile key={tile.href} {...tile} />
          ))}
        </HubGrid>
      </PageContainer>
      <AppFooter />
    </div>
  )
}
