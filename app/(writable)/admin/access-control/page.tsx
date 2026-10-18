// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useEffect, useState } from "react"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import Badge from "@/components/ui/Badge"
import Banner from "@/components/ui/Banner"
import ListCard, { CardList } from "@/components/ui/ListCard"
import PageContainer from "@/components/ui/PageContainer"
import { administrationTrail } from "@/lib/ui/breadcrumbs"

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
      <PageContainer area="admin" trail={administrationTrail({ label: "Access Control" })}>
        <Banner kind="info">
          Read-only view of who is in each Entra security group configured for this instance. Membership changes are made in the Microsoft Entra portal — this screen cannot add or remove members.
        </Banner>

        {error && <Banner kind="error">{error}</Banner>}
        {loading && <p className="fc-admin-note">Loading…</p>}

        {!loading && data?.message && <Banner kind="info">{data.message}</Banner>}

        {!loading && data && data.groups.length > 0 && (
          <CardList>
            {data.groups.map(g => (
              <ListCard
                key={g.groupId}
                title={g.role}
                meta={[`${g.groupDisplayName || "Unnamed group"} · ${g.envVar}`, g.groupId]}
                extras={
                  <div className="fc-members">
                    {g.error && <p className="fc-members__error"><span aria-hidden="true">⚠ </span>{g.error}</p>}
                    {!g.error && g.members.length === 0 && <p>No members returned.</p>}
                    {!g.error && g.members.length > 0 && (
                      <ul>
                        {g.members.map(m => (
                          <li key={m.id}>
                            <span className="fc-members__name">{m.displayName || m.email || m.id}</span>
                            {m.email && m.displayName && <span> {m.email}</span>}
                            {m.type !== "user" && <> <Badge tone="neutral">{m.type}</Badge></>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                }
              />
            ))}
          </CardList>
        )}
      </PageContainer>
      <AppFooter />
    </div>
  )
}
