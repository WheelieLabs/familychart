// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import { announce } from "@/lib/announce"
import Badge from "@/components/ui/Badge"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import EmptyState, { EMPTY_STATE_ICONS } from "@/components/ui/EmptyState"
import ListCard, { CardList } from "@/components/ui/ListCard"
import PageContainer from "@/components/ui/PageContainer"
import { FcTabBar, type FcTabItem } from "@/components/ui/FcTabBar"
import RestoreFromExport from "@/components/RestoreFromExport"
import ExportDownloadDialog, { UNENCRYPTED_EXPORT_NOTICE } from "@/components/ExportDownloadDialog"
import type { Person } from "@/lib/domain-types"
import { downloadPersonExport } from "@/lib/export/download-person-export"
import { exportExceedsProxyWarning, formatExportSize } from "@/lib/export/export-size"
import { administrationTrail } from "@/lib/ui/breadcrumbs"

type ExportTab = "export" | "restore"

const EXPORT_TABS: readonly FcTabItem<ExportTab>[] = [
  { value: "export", label: "Export" },
  { value: "restore", label: "Restore" },
]

interface HouseholdExportSize {
  bytes: number
  reportBytes: number
}

type ExportPerson = Person & {
  export_total_bytes?: number
  export_report_bytes?: number
}

export default function AdminExportPage({ maxUploadMb = 512 }: { maxUploadMb?: number }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tab: ExportTab = searchParams.get("tab") === "restore" ? "restore" : "export"
  const [people, setPeople] = useState<ExportPerson[]>([])
  const [loading, setLoading] = useState(true)
  const [actionError, setActionError] = useState("")
  const [size, setSize] = useState<HouseholdExportSize | null>(null)
  const [dialog, setDialog] = useState<null | { kind: "household" } | { kind: "person"; id: number }>(null)
  const [setupIncomplete, setSetupIncomplete] = useState(false)

  function loadPeople() {
    return fetch("/api/people?include_inactive=1")
      .then(r => r.json())
      .then((data: ExportPerson[]) => { if (Array.isArray(data)) setPeople(data) })
  }

  useEffect(() => {
    loadPeople().finally(() => setLoading(false))
    fetch("/api/setup/status")
      .then(r => (r.ok ? r.json() : null))
      .then((data: { complete?: boolean } | null) => {
        if (data && data.complete === false) setSetupIncomplete(true)
      })
      .catch(() => {})
    fetch("/api/export/household/size")
      .then(r => (r.ok ? r.json() : null))
      .then((data: HouseholdExportSize | null) => {
        if (data && typeof data.bytes === "number" && typeof data.reportBytes === "number") setSize(data)
      })
      .catch(() => {})
  }, [])

  async function reactivate(person: ExportPerson) {
    setActionError("")
    const res = await fetch(`/api/people/${person.id}/reactivate`, { method: "POST" })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setActionError(typeof body.error === "string" ? body.error : "Could not reactivate this person.")
      return
    }
    announce(`${person.name} is back on the family list.`)
    await loadPeople()
  }

  async function downloadHousehold(passphrase: string | null) {
    const res = passphrase
      ? await fetch("/api/export/household", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase }),
      })
      : await fetch("/api/export/household")
    if (!res.ok) throw new Error("Export failed")
    const url = URL.createObjectURL(await res.blob())
    const link = document.createElement("a")
    link.href = url
    link.download = "household-export.zip"
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    announce("Household export downloaded.", "polite")
  }

  const householdLarge = size !== null && exportExceedsProxyWarning(size.bytes)
  const personLarge = people.some(p => typeof p.export_total_bytes === "number" && exportExceedsProxyWarning(p.export_total_bytes))

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Data Export & Restore" />
      <PageContainer
        area="admin"
        trail={administrationTrail({ label: "Data Export & Restore" })}
        tabs={<FcTabBar tabs={EXPORT_TABS} active={tab} onSelect={value => router.replace(`?tab=${value}`)} />}
      >
        {setupIncomplete && (
          <Banner kind="info">
            Restore from an export instead of adding a first person. When the restore is finished, continue setup.{" "}
            <Button variant="secondary" href="/setup">Continue setup</Button>
          </Banner>
        )}
        <div role="tabpanel" hidden={tab !== "export"} className="flex flex-col gap-4">
        <Banner kind="warning">
          {UNENCRYPTED_EXPORT_NOTICE}
        </Banner>
        {actionError && <Banner kind="error" announced>{actionError}</Banner>}
        {(householdLarge || personLarge) && (
          <Banner kind="warning">
            A proxy may reject uploading a file this large later. Export each Person individually.
          </Banner>
        )}
        <p className="fc-export-note">
          {size ? formatExportSize(size.bytes, size.reportBytes) : "Estimating the household export…"}
        </p>
        <Button onClick={() => setDialog({ kind: "household" })}>
          Download household export
        </Button>
        <p className="fc-export-note">
          Download one Person&apos;s record as a zip: their history, the medications, rules, schedules,
          goals and expectations they use, their photo and stored reports, and spreadsheet copies.
          The file opens with a manifest that names any photo or report it could not include.
        </p>
        {loading && <p className="fc-export-note">Loading…</p>}
        {!loading && people.length === 0 && (
          <EmptyState icon={EMPTY_STATE_ICONS.noPeople} heading="No people yet">
            Add a person under Management, then come back to export their record.
          </EmptyState>
        )}
        <CardList>
          {people.map(p => (
            <ListCard
              key={p.id}
              title={p.name}
              avatar={{ src: p.photo_url, name: p.name }}
              inactive={p.is_active === 0}
              meta={typeof p.export_total_bytes === "number" && typeof p.export_report_bytes === "number"
                ? [formatExportSize(p.export_total_bytes, p.export_report_bytes)]
                : []}
              extras={
                <>
                  {p.is_active === 0 && <Badge tone="neutral">Inactive</Badge>}
                  <Button aria-label={`Download export for ${p.name}`} onClick={() => setDialog({ kind: "person", id: p.id })}>
                    Download export
                  </Button>
                  {p.is_active === 0 && (
                    <>
                      <Button variant="secondary" aria-label={`Reactivate ${p.name}`} onClick={() => { void reactivate(p) }}>
                        Reactivate
                      </Button>
                      <Button variant="destructive" aria-label={`Erase ${p.name}`} onClick={() => router.push(`/admin/export/${p.id}/erase`)}>
                        Erase
                      </Button>
                    </>
                  )}
                </>
              }
            />
          ))}
        </CardList>
        </div>
        <div role="tabpanel" hidden={tab !== "restore"} className="flex flex-col gap-4">
          <RestoreFromExport maxUploadMb={maxUploadMb} />
        </div>
        <ExportDownloadDialog
          open={dialog !== null}
          title={dialog?.kind === "household" ? "Download household export" : "Download export"}
          onClose={() => setDialog(null)}
          onDownload={async passphrase => {
            if (!dialog) return
            if (dialog.kind === "household") await downloadHousehold(passphrase)
            else await downloadPersonExport(dialog.id, passphrase)
            setDialog(null)
          }}
        />
      </PageContainer>
      <AppFooter />
    </div>
  )
}
