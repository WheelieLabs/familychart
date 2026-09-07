// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useEffect, useState } from "react"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import ConfirmModal from "@/components/ConfirmModal"
import { mainContentTargetProps } from "@/lib/a11y"

type FileRow = {
  filename: string
  path: string
  url: string
  sizeBytes: number
  encrypted: boolean
  orphan: boolean
  personId: number | null
  personName: string | null
}

type Scan = {
  files: FileRow[]
  totalBytes: number
  orphanCount: number
  orphanBytes: number
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export default function AdminFilesPage() {
  const [scan, setScan] = useState<Scan | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [purging, setPurging] = useState(false)
  const [confirmPurge, setConfirmPurge] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/admin/files")
      if (!res.ok) {
        setError("Failed to scan household files")
        setScan(null)
        return
      }
      setScan(await res.json())
    } catch {
      setError("Failed to scan household files")
      setScan(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function purgeOrphans() {
    setPurging(true)
    setError("")
    try {
      const res = await fetch("/api/admin/files", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purgeAllOrphans: true }),
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

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Files" />
      <main {...mainContentTargetProps} className="fc-surface-admin fc-scroll p-4">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          <p className="text-sm text-white/80">
            Household uploads under <code className="text-white/90">uploads/people/</code>.
            Orphans are files not referenced by any person photo.
          </p>

          {error && (
            <div className="rounded-lg bg-red-900/40 text-red-100 text-sm px-3 py-2">{error}</div>
          )}

          <div className="flex flex-wrap gap-3 items-center">
            <button
              type="button"
              onClick={() => load()}
              disabled={loading}
              className="rounded-lg bg-fc-blue-mid hover:bg-fc-blue-dark text-white text-sm font-medium px-3 py-2 disabled:opacity-50"
            >
              {loading ? "Scanning…" : "Refresh"}
            </button>
            {scan && scan.orphanCount > 0 && (
              <button
                type="button"
                onClick={() => setConfirmPurge(true)}
                disabled={purging}
                className="rounded-lg bg-red-800/80 hover:bg-red-700 text-white text-sm font-medium px-3 py-2 disabled:opacity-50"
              >
                Purge {scan.orphanCount} orphan{scan.orphanCount === 1 ? "" : "s"}
              </button>
            )}
          </div>

          {scan && (
            <div className="text-sm text-white/80 flex flex-wrap gap-x-4 gap-y-1">
              <span>Total: {formatBytes(scan.totalBytes)} ({scan.files.length} file{scan.files.length === 1 ? "" : "s"})</span>
              <span>
                Orphans: {formatBytes(scan.orphanBytes)} ({scan.orphanCount})
              </span>
            </div>
          )}

          {loading && !scan ? (
            <p className="text-white/70 text-sm">Scanning…</p>
          ) : scan && scan.files.length === 0 ? (
            <p className="text-white/70 text-sm">No upload files found.</p>
          ) : scan ? (
            <ul className="flex flex-col gap-2">
              {scan.files.map(f => (
                <li
                  key={f.filename}
                  className="rounded-xl bg-fc-blue/40 px-4 py-3 text-white text-sm flex flex-col gap-1"
                >
                  <div className="font-medium break-all">{f.filename}</div>
                  <div className="text-white/70 text-xs flex flex-wrap gap-x-3 gap-y-1">
                    <span>{formatBytes(f.sizeBytes)}</span>
                    <span>{f.encrypted ? "Encrypted" : "Plaintext"}</span>
                    {f.orphan ? (
                      <span className="text-amber-200">Orphan</span>
                    ) : (
                      <span>
                        {f.personName ?? `Person #${f.personId}`}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </main>
      <AppFooter />

      <ConfirmModal
        open={confirmPurge}
        title="Purge orphan files?"
        message={
          scan
            ? `Delete ${scan.orphanCount} orphan file${scan.orphanCount === 1 ? "" : "s"} (${formatBytes(scan.orphanBytes)})? Referenced photos are never deleted.`
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
