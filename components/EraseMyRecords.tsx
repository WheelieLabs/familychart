// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useState } from "react"
import ErasePersonConfirm from "@/components/ErasePersonConfirm"
import Button from "@/components/ui/Button"
import Panel from "@/components/ui/Panel"

/** Profile → Account erase for the signed-in Account's own linked Person. */
export default function EraseMyRecords({
  personId,
  isLocal,
  mfaEnrolled,
}: {
  personId: number
  isLocal: boolean
  mfaEnrolled: boolean
}) {
  const [open, setOpen] = useState(false)
  if (open) {
    return <ErasePersonConfirm personId={personId} mode="self" isLocal={isLocal} mfaEnrolled={mfaEnrolled} />
  }
  return (
    <Panel>
      <h2 className="fc-section-title">Erase my records</h2>
      <p className="fc-section-copy">
        Permanently delete your records from this instance. Your account stays unless an administrator removes it.
      </p>
      <Button variant="destructive" onClick={() => setOpen(true)}>Erase my records</Button>
    </Panel>
  )
}
