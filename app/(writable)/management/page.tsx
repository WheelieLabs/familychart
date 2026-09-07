// SPDX-License-Identifier: AGPL-3.0-only

import Link from "next/link"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import { mainContentTargetProps } from "@/lib/a11y"

interface Card {
  icon: string
  title: string
  description: string
  href: string
  comingSoon?: boolean
}

const CARDS: Card[] = [
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
    title: "Import Data",
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
      <main {...mainContentTargetProps} className="fc-surface-app fc-scroll p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-w-4xl mx-auto">
          {CARDS.map(card => (
            <Link
              key={card.href}
              href={card.href}
              className="rounded-xl p-5 flex flex-col gap-3 bg-fc-blue-mid hover:bg-fc-blue-dark
                         active:bg-fc-blue-dark shadow-md cursor-pointer transition-colors"
            >
              <span className="text-3xl">{card.icon}</span>
              <div>
                <div className="text-white font-bold text-base leading-tight">{card.title}</div>
                {card.comingSoon && (
                  <span className="mt-1 inline-block text-xs bg-white/20 text-white/80 rounded-full px-2 py-0.5">
                    Coming soon
                  </span>
                )}
                <div className={`text-white/70 text-xs leading-snug ${card.comingSoon ? "mt-2" : "mt-1"}`}>
                  {card.description}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </main>
      <AppFooter />
    </div>
  )
}
