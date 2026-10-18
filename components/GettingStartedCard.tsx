// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import Button from "@/components/ui/Button"
import Panel from "@/components/ui/Panel"

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
    <div className="mx-4 mt-4 mb-2">
      <Panel>
        <div className="fc-log-head">
          <h2 className="fc-section-title">Getting started</h2>
          <Button variant="quiet" onClick={dismiss}>Dismiss</Button>
        </div>
        <p className="fc-section-copy">Suggested next steps:</p>
        <ul className="fc-steps">
          {showManagementHints && (
            <>
              <li>
                <Link href="/management/medications?tab=medications">Add medications</Link>
                {" "}— build your catalogue and dosing rules
              </li>
              <li>
                <Link href="/management/people">Add another person</Link>
                {" "}— for more family members
              </li>
            </>
          )}
          {!showManagementHints && (
            <li>A manager or administrator can add medications, dosing rules, and family members from Management.</li>
          )}
          <li>
            <Link href={obsHref}>Record an observation</Link>
            {firstPersonId != null
              ? " — log weight, temperature, and more"
              : showManagementHints
                ? " — add a person first if you skipped that step"
                : " — ask a manager to add you or a household member"}
          </li>
        </ul>
      </Panel>
    </div>
  )
}
