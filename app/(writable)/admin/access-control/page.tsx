// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import { mainContentTargetProps } from "@/lib/a11y"

interface Member {
  id: string
  displayName: string | null
  email: string | null
  type: "user" | "group" | "other"
}

interface GroupBlock {
  role: string
  envVar: string
  groupId: string
  groupDisplayName: string | null
  members: Member[]
  error?: string
}

interface AccessControlResponse {
  status: string
  groups: GroupBlock[]
  message?: string
}

export default function AdminAccessControlPage() {
  const [data, setData] = useState<AccessControlResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/admin/access-control")
      if (!res.ok) {
        setError("Failed to load access control")
        setData(null)
        return
      }
      setData(await res.json())
    } catch {
      setError("Failed to load access control")
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Access Control" />
      <main {...mainContentTargetProps} className="fc-surface-admin fc-scroll p-3 flex flex-col gap-3">
        <div className="rounded-xl bg-fc-panel px-4 py-3 text-sm text-gray-800 leading-relaxed">
          Read-only view of who is in each Entra security group configured for this instance.
          Membership changes are made in the Microsoft Entra portal — this screen cannot add or
          remove members.{" "}
          <Link href="/admin/overview" className="underline font-medium text-fc-blue">
            Back to Administration
          </Link>
        </div>

        {error && <p className="text-red-200 text-sm px-1">{error}</p>}
        {loading && <p className="text-white text-center py-8">Loading…</p>}

        {!loading && data?.message && (
          <div className="rounded-xl bg-white/10 px-4 py-3 text-sm text-white leading-relaxed">
            {data.message}
          </div>
        )}

        {!loading && data && data.groups.length > 0 && (
          <ul className="flex flex-col gap-3">
            {data.groups.map(g => (
              <li key={g.groupId} className="rounded-xl bg-white/10 px-4 py-3 text-white">
                <div className="font-bold text-base">{g.role}</div>
                <div className="text-xs text-white/80 mt-0.5">
                  {g.groupDisplayName || "Unnamed group"} · {g.envVar}
                </div>
                <div className="text-xs font-mono text-white/70 mt-0.5 break-all">{g.groupId}</div>

                {g.error && (
                  <p className="text-red-200 text-sm mt-2">{g.error}</p>
                )}

                {!g.error && g.members.length === 0 && (
                  <p className="text-white/80 text-sm mt-2">No members returned.</p>
                )}

                {!g.error && g.members.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {g.members.map(m => (
                      <li key={m.id} className="text-sm flex flex-wrap gap-x-2 gap-y-0.5">
                        <span className="font-medium">
                          {m.displayName || m.email || m.id}
                        </span>
                        {m.email && m.displayName && (
                          <span className="text-white/80">{m.email}</span>
                        )}
                        {m.type !== "user" && (
                          <span className="text-xs bg-white/20 rounded px-1.5 py-0.5">{m.type}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
      <AppFooter />
    </div>
  )
}
