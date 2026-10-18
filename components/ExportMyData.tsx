// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useState } from "react"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import Panel from "@/components/ui/Panel"
import ExportDownloadDialog, { UNENCRYPTED_EXPORT_NOTICE } from "@/components/ExportDownloadDialog"
import { downloadPersonExport } from "@/lib/export/download-person-export"
import { exportExceedsProxyWarning, formatExportSize } from "@/lib/export/export-size"

interface Estimate {
  total_bytes: number
  report_bytes: number
}

/** Profile → Account entry for the signed-in Account's own linked Person. */
export default function ExportMyData({ personId }: { personId: number }) {
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/people/${personId}/export/estimate`)
      .then(r => (r.ok ? r.json() as Promise<Estimate> : null))
      .then(data => { if (!cancelled && data) setEstimate(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [personId])

  return (
    <Panel>
      <h2 className="fc-section-title">Export my data</h2>
      <Banner kind="warning">
        {UNENCRYPTED_EXPORT_NOTICE}
      </Banner>
      {estimate && exportExceedsProxyWarning(estimate.total_bytes) && (
        <Banner kind="warning">
          A proxy may reject uploading a file this large later. Export each Person individually.
        </Banner>
      )}
      {estimate && (
        <p className="fc-section-copy">{formatExportSize(estimate.total_bytes, estimate.report_bytes)}</p>
      )}
      <Button onClick={() => setOpen(true)}>Export my data</Button>
      <ExportDownloadDialog
        open={open}
        title="Export my data"
        onClose={() => setOpen(false)}
        onDownload={async passphrase => {
          await downloadPersonExport(personId, passphrase)
          setOpen(false)
        }}
      />
    </Panel>
  )
}
