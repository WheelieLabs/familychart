// SPDX-License-Identifier: AGPL-3.0-only

import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import { mainContentTargetProps } from "@/lib/a11y"
import Link from "next/link"

export default function NotFoundPage() {
  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Page Not Found" />
      <main {...mainContentTargetProps} className="flex-1 bg-fc-blue flex flex-col items-center justify-center gap-6 px-8 text-center">
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <circle cx="28" cy="28" r="18" stroke="rgba(255,255,255,0.4)" strokeWidth="4"/>
          <circle cx="28" cy="28" r="18" stroke="white" strokeWidth="4" strokeDasharray="8 4"/>
          <path d="M41 41 L54 54" stroke="white" strokeWidth="4.5" strokeLinecap="round"/>
          <path d="M23 28h10M28 23v10" stroke="rgba(255,255,255,0.5)" strokeWidth="3" strokeLinecap="round"/>
        </svg>
        <div className="space-y-2">
          <h2 className="text-white font-bold text-2xl">Page Not Found</h2>
          <p className="text-white/80 text-base max-w-xs">
            This page doesn&apos;t exist or may have been moved.
          </p>
        </div>
        <Link
          href="/"
          className="bg-white text-fc-blue font-bold px-6 py-3 rounded-xl hover:bg-gray-100 active:bg-gray-200 transition-colors"
        >
          Go Home
        </Link>
      </main>
      <AppFooter />
    </div>
  )
}
