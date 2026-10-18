// SPDX-License-Identifier: AGPL-3.0-only

import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import { HubGrid, HubTile } from "@/components/ui/HubTile"
import PageContainer from "@/components/ui/PageContainer"
import type { Metadata } from "next"

export const metadata: Metadata = { title: "Diagnostics" }

interface DiagnosticTool {
  href: string
  icon: string
  title: string
  description: string
}

const TOOLS: DiagnosticTool[] = [
  {
    href: "/diagnostics/app-lock",
    icon: "🔒",
    title: "App Lock",
    description: "Probe this device's WebAuthn behaviour and inspect its App lock state",
  },
]

/** Index of diagnostic tools, linked from the footer. */
export default function DiagnosticsPage() {
  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Diagnostics" />
      <PageContainer>
        <HubGrid>
          {TOOLS.map(tool => (
            <HubTile key={tool.href} {...tool} />
          ))}
        </HubGrid>
      </PageContainer>
      <AppFooter />
    </div>
  )
}
