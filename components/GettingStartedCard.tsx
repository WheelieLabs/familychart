// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

const STORAGE_KEY = "fc_getting_started_dismissed"

export default function GettingStartedCard({
  showWelcome,
  firstPersonId,
  showManagementHints,
}: {
  showWelcome: boolean
  firstPersonId: number | null
  showManagementHints: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!showWelcome) return
    if (typeof window === "undefined") return
    if (localStorage.getItem(STORAGE_KEY)) return
    setOpen(true)
  }, [showWelcome])

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, "1")
    setOpen(false)
    router.replace("/")
  }

  if (!open) return null

  const obsHref =
    firstPersonId != null
      ? `/${firstPersonId}/record-observation`
      : showManagementHints
        ? "/management/people"
        : "/"

  return (
    <div className="mx-4 mt-4 mb-2 rounded-xl border border-white/30 bg-white/15 backdrop-blur-sm text-white px-4 py-4 shadow-md">
      <div className="flex justify-between gap-2 items-start mb-3">
        <h2 className="font-bold text-lg">Getting started</h2>
        <button
          type="button"
          onClick={dismiss}
          className="text-white hover:text-white text-sm shrink-0 px-2 py-0.5 rounded-lg hover:bg-white/10"
          aria-label="Dismiss"
        >
          Dismiss
        </button>
      </div>
      <p className="text-sm text-white mb-3">Suggested next steps:</p>
      <ul className="flex flex-col gap-2 text-sm">
        {showManagementHints && (
          <>
            <li>
              <Link href="/management/medications?tab=medications" className="font-medium underline underline-offset-2 hover:text-white">
                Add medications
              </Link>
              <span className="text-white"> — build your catalogue and dosing rules</span>
            </li>
            <li>
              <Link href="/management/people" className="font-medium underline underline-offset-2 hover:text-white">
                Add another person
              </Link>
              <span className="text-white"> — for more family members</span>
            </li>
          </>
        )}
        {!showManagementHints && (
          <li className="text-white">
            <span className="text-white">A manager or administrator can add medications, dosing rules, and family members from Management.</span>
          </li>
        )}
        <li>
          <Link href={obsHref} className="font-medium underline underline-offset-2 hover:text-white">
            Record an observation
          </Link>
          <span className="text-white">
            {firstPersonId != null
              ? " — log weight, temperature, and more"
              : showManagementHints
                ? " — add a person first if you skipped that step"
                : " — ask a manager to add you or a household member"}
          </span>
        </li>
      </ul>
    </div>
  )
}
