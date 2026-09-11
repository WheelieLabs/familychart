// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"

interface BackButtonProps {
  href?: string
  className?: string
}

export default function BackButton({ href, className = "" }: BackButtonProps) {
  const router = useRouter()

  const icon = (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M15 18l-6-6 6-6" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )

  const base =
    "flex items-center justify-center min-h-[44px] min-w-[44px] text-white rounded-lg " +
    "hover:bg-white/10 active:bg-white/20 transition-colors " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"

  if (href) {
    return (
      <Link href={href} className={`${base} ${className}`} aria-label="Go back">
        {icon}
      </Link>
    )
  }

  return (
    <button type="button" onClick={() => router.back()} className={`${base} ${className}`} aria-label="Go back">
      {icon}
    </button>
  )
}
