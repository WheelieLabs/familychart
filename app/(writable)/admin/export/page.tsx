// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useState } from "react"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import type { Person } from "@/lib/domain-types"
import { mainContentTargetProps } from "@/lib/a11y"

export default function AdminExportPage() {
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/people")
      .then(r => r.json())
      .then((data: Person[]) => setPeople(data))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Data export" />
      <main {...mainContentTargetProps} className="fc-surface-admin fc-scroll p-4">
        <div className="max-w-lg mx-auto">
          <p className="text-sm text-white/80 mb-4">
            Download a full record for one person — administrations, observations, and their photo,
            as CSV files, a full-fidelity JSON bundle, and attachments in a single zip.
          </p>
          {loading && <p className="text-sm text-white/70">Loading…</p>}
          {!loading && people.length === 0 && (
            <p className="text-sm text-white/70">No people yet.</p>
          )}
          <ul className="flex flex-col gap-2">
            {people.map(p => (
              <li key={p.id}
                className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-3">
                <span className="font-medium text-gray-800">{p.name}</span>
                <a
                  href={`/api/people/${p.id}/export`}
                  download
                  className="text-sm font-semibold text-fc-blue-mid hover:text-fc-blue-dark"
                >
                  Download export
                </a>
              </li>
            ))}
          </ul>
        </div>
      </main>
      <AppFooter />
    </div>
  )
}
