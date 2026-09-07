// SPDX-License-Identifier: AGPL-3.0-only

import Link from "next/link"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import { mainContentTargetProps } from "@/lib/a11y"
import { getDb } from "@/lib/db"
import { isEntraProviderActive } from "@/lib/settings/auth-settings"

interface PlaceholderCard {
  icon: string
  title: string
  description: string
}

/** Permanent placeholders — decided not to ship in-app backup tooling. */
const PLACEHOLDER_CARDS: PlaceholderCard[] = [
  {
    icon: "🗄️",
    title: "Database",
    description: "Backup and maintenance tools",
  },
]

export default function AdminOverviewPage() {
  const entraActive = isEntraProviderActive(getDb())

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Administration" />
      <main {...mainContentTargetProps} className="fc-surface-admin fc-scroll p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-w-4xl mx-auto">
          <Link
            href="/admin/accounts"
            className="rounded-xl p-5 flex flex-col gap-3 bg-fc-blue-mid hover:bg-fc-blue-dark
                       active:bg-fc-blue-dark shadow-md cursor-pointer transition-colors"
          >
            <span className="text-3xl">🔑</span>
            <div>
              <div className="text-white font-bold text-base leading-tight">Accounts</div>
              <div className="text-white text-xs mt-1 leading-snug">
                Invite people to sign in and manage existing accounts
              </div>
            </div>
          </Link>

          {entraActive && (
            <Link
              href="/admin/entra-sessions"
              className="rounded-xl p-5 flex flex-col gap-3 bg-fc-blue-mid hover:bg-fc-blue-dark
                         active:bg-fc-blue-dark shadow-md cursor-pointer transition-colors"
            >
              <span className="text-3xl">🛡️</span>
              <div>
                <div className="text-white font-bold text-base leading-tight">Entra Sessions</div>
                <div className="text-white text-xs mt-1 leading-snug">
                  Revoke Microsoft sign-ins instantly
                </div>
              </div>
            </Link>
          )}

          <Link
            href="/admin/access-control"
            className="rounded-xl p-5 flex flex-col gap-3 bg-fc-blue-mid hover:bg-fc-blue-dark
                       active:bg-fc-blue-dark shadow-md cursor-pointer transition-colors"
          >
            <span className="text-3xl">🔐</span>
            <div>
              <div className="text-white font-bold text-base leading-tight">Access Control</div>
              <div className="text-white text-xs mt-1 leading-snug">
                View Entra group membership for this instance
              </div>
            </div>
          </Link>

          <Link
            href="/admin/audit-log"
            className="rounded-xl p-5 flex flex-col gap-3 bg-fc-blue-mid hover:bg-fc-blue-dark
                       active:bg-fc-blue-dark shadow-md cursor-pointer transition-colors"
          >
            <span className="text-3xl">📋</span>
            <div>
              <div className="text-white font-bold text-base leading-tight">Audit Log</div>
              <div className="text-white text-xs mt-1 leading-snug">
                View full system audit trail
              </div>
            </div>
          </Link>

          <Link
            href="/admin/system-settings"
            className="rounded-xl p-5 flex flex-col gap-3 bg-fc-blue-mid hover:bg-fc-blue-dark
                       active:bg-fc-blue-dark shadow-md cursor-pointer transition-colors"
          >
            <span className="text-3xl">⚙️</span>
            <div>
              <div className="text-white font-bold text-base leading-tight">System Settings</div>
              <div className="text-white text-xs mt-1 leading-snug">
                Application configuration
              </div>
            </div>
          </Link>

          <Link
            href="/admin/files"
            className="rounded-xl p-5 flex flex-col gap-3 bg-fc-blue-mid hover:bg-fc-blue-dark
                       active:bg-fc-blue-dark shadow-md cursor-pointer transition-colors"
          >
            <span className="text-3xl">📁</span>
            <div>
              <div className="text-white font-bold text-base leading-tight">Files</div>
              <div className="text-white text-xs mt-1 leading-snug">
                Household uploads, storage use, and orphan purge
              </div>
            </div>
          </Link>

          <Link
            href="/admin/export"
            className="rounded-xl p-5 flex flex-col gap-3 bg-fc-blue-mid hover:bg-fc-blue-dark
                       active:bg-fc-blue-dark shadow-md cursor-pointer transition-colors"
          >
            <span className="text-3xl">📦</span>
            <div>
              <div className="text-white font-bold text-base leading-tight">Data Export</div>
              <div className="text-white text-xs mt-1 leading-snug">
                Download a person&apos;s full record as CSV, JSON, and photo
              </div>
            </div>
          </Link>

          {PLACEHOLDER_CARDS.map(card => (
            <div
              key={card.title}
              className="rounded-xl p-5 flex flex-col gap-3 bg-fc-blue/40 cursor-default select-none"
            >
              <span className="text-3xl">{card.icon}</span>
              <div>
                <div className="text-white font-bold text-base leading-tight">{card.title}</div>
                <span className="mt-1 inline-block text-xs bg-white/20 text-white rounded-full px-2 py-0.5">
                  Coming soon
                </span>
                <div className="text-white text-xs mt-2 leading-snug">{card.description}</div>
              </div>
            </div>
          ))}
        </div>
      </main>
      <AppFooter />
    </div>
  )
}
