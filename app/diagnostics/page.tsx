// SPDX-License-Identifier: AGPL-3.0-only

import Link from "next/link"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import { mainContentTargetProps } from "@/lib/a11y"

interface DiagnosticTool {
  href: string
  title: string
  description: string
}

const TOOLS: DiagnosticTool[] = [
  {
    href: "/diagnostics/app-lock",
    title: "App lock",
    description: "Probe this device's WebAuthn behaviour and inspect its App lock state",
  },
]

/** Index of diagnostic tools, linked from the footer. */
export default function DiagnosticsPage() {
  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Diagnostics" />
      <main {...mainContentTargetProps} className="flex-1 bg-fc-blue fc-scroll px-4 py-6">
        <div className="mx-auto flex max-w-xl flex-col gap-3">
          {TOOLS.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="rounded-xl bg-white p-4 shadow-sm hover:bg-gray-50"
            >
              <div className="font-bold text-gray-800">{tool.title}</div>
              <div className="text-sm text-gray-600">{tool.description}</div>
            </Link>
          ))}
        </div>
      </main>
      <AppFooter />
    </div>
  )
}
