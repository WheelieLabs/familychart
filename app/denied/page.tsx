// SPDX-License-Identifier: AGPL-3.0-only

import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import { mainContentTargetProps } from "@/lib/a11y"
import Link from "next/link"

interface Props { searchParams: Promise<{ reason?: string }> }

export default async function DeniedPage({ searchParams }: Props) {
  const { reason } = await searchParams
  const message = reason === "no-group"
    ? "Your account is not assigned to any FamilyChart access group. Please contact the administrator."
    : "You don't have permission to access this area."

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Access Denied" />
      <main {...mainContentTargetProps} className="flex-1 bg-fc-blue flex flex-col items-center justify-center gap-6 px-8 text-center">
        <div className="text-6xl">🔒</div>
        <h2 className="text-white font-bold text-2xl">Access Denied</h2>
        <p className="text-white/80 text-base max-w-xs">{message}</p>
        <Link href="/"
          className="bg-white text-fc-blue font-bold px-6 py-3 rounded-xl hover:bg-gray-100 transition-colors">
          Go Home
        </Link>
      </main>
      <AppFooter />
    </div>
  )
}
