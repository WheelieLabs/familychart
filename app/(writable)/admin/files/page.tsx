// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useEffect, useState } from "react"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import AttachmentLink from "@/components/AttachmentViewer"
import ConfirmModal from "@/components/ConfirmModal"
import { FcTabBar, type FcTabItem } from "@/components/ui/FcTabBar"
import Badge from "@/components/ui/Badge"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import EmptyState, { EMPTY_STATE_ICONS } from "@/components/ui/EmptyState"
import ListCard, { CardList } from "@/components/ui/ListCard"
import PageContainer from "@/components/ui/PageContainer"
import { administrationTrail } from "@/lib/ui/breadcrumbs"
import { formatDate } from "@/lib/date-format"
import type { AttachmentsScan, HouseholdFilesScan } from "@/lib/household-files"

type Tab = "photos" | "attachments"

const TABS: readonly FcTabItem<Tab>[] = [
  { value: "photos", label: "Photos" },
  { value: "attachments", label: "Attachments" },
]

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

export default function AdminFilesPage() {
  const [tab, setTab] = useState<Tab>("photos")
  const [photos, setPhotos] = useState<HouseholdFilesScan | null>(null)
  const [attachments, setAttachments] = useState<AttachmentsScan | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [purging, setPurging] = useState(false)
  const [confirmPurge, setConfirmPurge] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [photosRes, attachmentsRes] = await Promise.all([
        fetch("/api/admin/files"),
        fetch("/api/admin/files?kind=attachments"),
      ])
      if (!photosRes.ok || !attachmentsRes.ok) {
        setError("Failed to scan household files")
        return
      }
      setPhotos(await photosRes.json())
      setAttachments(await attachmentsRes.json())
    } catch {
      setError("Failed to scan household files")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const active = tab === "photos" ? photos : attachments

  async function purgeOrphans() {
    setPurging(true)
    setError("")
    try {
      const res = await fetch("/api/admin/files", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purgeAllOrphans: true, kind: tab }),
      })
      if (!res.ok) {
        setError("Purge failed")
        return
      }
      setConfirmPurge(false)
      await load()
    } catch {
      setError("Purge failed")
    } finally {
      setPurging(false)
    }
  }

  const photoBytes = photos?.totalBytes ?? 0
  const attachmentBytes = attachments?.totalBytes ?? 0

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Files" />
      <PageContainer area="admin" trail={administrationTrail({ label: "Files" })} tabs={<FcTabBar tabs={TABS} active={tab} onSelect={setTab} />}>
        {photos && attachments && (
          <section aria-labelledby="files-storage" className="fc-files-summary">
            <h2 id="files-storage" className="fc-files-summary__label">Space used by uploads</h2>
            <p className="fc-files-summary__total">{formatBytes(photoBytes + attachmentBytes)}</p>
            <p className="fc-files-summary__split">
              <span>Photos {formatBytes(photoBytes)} ({plural(photos.files.length, "file")})</span>
              {" · "}
              <span>Attachments {formatBytes(attachmentBytes)} ({plural(attachments.files.length, "file")})</span>
            </p>
          </section>
        )}

        <p className="fc-files-note">
          {tab === "photos" ? (
            <>Person photos under <code>uploads/people/</code>. Orphans are files not referenced by any person photo.</>
          ) : (
            <>Test result reports under <code>uploads/test-results/</code>. Orphans are files no test result references; a missing file is referenced by a test result but not on disk.</>
          )}
        </p>

        {error && <Banner kind="error" announced>{error}</Banner>}

        <div className="fc-files-actions">
          <Button variant="secondary" size="compact" onClick={() => load()} pending={loading} pendingLabel="Scanning…">
            Refresh
          </Button>
          {active && active.orphanCount > 0 && (
            <Button variant="secondary" size="compact" onClick={() => setConfirmPurge(true)} pending={purging} pendingLabel="Purging…">
              Purge {plural(active.orphanCount, "orphan")}
            </Button>
          )}
        </div>

        {loading && !active ? (
          <p className="fc-files-note">Scanning…</p>
        ) : tab === "photos" && photos ? (
          <PhotosList scan={photos} />
        ) : tab === "attachments" && attachments ? (
          <AttachmentsList scan={attachments} />
        ) : null}
      </PageContainer>
      <AppFooter />

      <ConfirmModal
        open={confirmPurge}
        title={tab === "photos" ? "Purge orphan photos?" : "Purge orphan attachments?"}
        message={
          active
            ? `Delete ${plural(active.orphanCount, "orphan file")} (${formatBytes(active.orphanBytes)})? ${
                tab === "photos" ? "Referenced photos" : "Attachments a test result references"
              } are never deleted.`
            : "Delete orphan files?"
        }
        confirmLabel={purging ? "Purging…" : "Purge orphans"}
        variant="danger"
        onCancel={() => !purging && setConfirmPurge(false)}
        onConfirm={() => { void purgeOrphans() }}
      />
    </div>
  )
}

function Totals({ scan }: { scan: HouseholdFilesScan | AttachmentsScan }) {
  return (
    <p className="fc-files-note">
      <span>Total: {formatBytes(scan.totalBytes)} ({plural(scan.files.length, "file")})</span>
      {" · "}
      <span>Orphans: {formatBytes(scan.orphanBytes)} ({scan.orphanCount})</span>
    </p>
  )
}

function PhotosList({ scan }: { scan: HouseholdFilesScan }) {
  return (
    <>
      <Totals scan={scan} />
      {scan.files.length === 0 ? (
        <EmptyState icon={EMPTY_STATE_ICONS.noFiles} heading="No files yet">
          Person photos appear here once someone adds one.
        </EmptyState>
      ) : (
        <CardList>
          {scan.files.map(f => (
            <ListCard
              key={f.filename}
              title={f.filename}
              meta={[formatBytes(f.sizeBytes), f.encrypted ? "Encrypted" : "Plaintext", !f.orphan && (f.personName ?? `Person #${f.personId}`)]}
              extras={f.orphan ? <Badge tone="warning">Orphan</Badge> : undefined}
            />
          ))}
        </CardList>
      )}
    </>
  )
}

function AttachmentsList({ scan }: { scan: AttachmentsScan }) {
  return (
    <>
      <Totals scan={scan} />
      {scan.missingCount > 0 && <Banner kind="warning">{`${scan.missingCount} missing on disk`}</Banner>}

      {scan.byPerson.length > 0 && (
        <section aria-labelledby="files-per-person" className="fc-files-summary">
          <h2 id="files-per-person" className="fc-files-summary__label">Space per person</h2>
          <ul className="fc-files-people">
            {scan.byPerson.map(p => (
              <li key={p.personId}>
                <span>{p.personName} ({plural(p.fileCount, "file")})</span>
                <span className="tabular-nums">{formatBytes(p.bytes)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {scan.files.length === 0 ? (
        <EmptyState icon={EMPTY_STATE_ICONS.noFiles} heading="No attachments yet">
          Test result reports appear here once someone attaches one.
        </EmptyState>
      ) : (
        <CardList>
          {scan.files.map(f => (
            <ListCard
              key={f.filename}
              title={
                f.events.length > 0
                  ? f.events.map(e => `${e.name} — ${e.personName}, ${formatDate(e.date)}`).join("; ")
                  : f.filename
              }
              meta={[
                f.missing ? "—" : formatBytes(f.sizeBytes),
                !f.missing && (f.encrypted ? "Encrypted" : "Plaintext"),
                f.filename,
              ]}
              extras={
                <>
                  {f.orphan && <Badge tone="warning">Orphan</Badge>}
                  {f.missing && <Badge tone="warning">Missing on disk</Badge>}
                  {!f.missing && <AttachmentLink url={f.url}>View</AttachmentLink>}
                </>
              }
            />
          ))}
        </CardList>
      )}
    </>
  )
}
