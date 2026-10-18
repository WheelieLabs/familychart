// SPDX-License-Identifier: AGPL-3.0-only

import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect, notFound } from "next/navigation"
import { getDb } from "@/lib/db"
import type { Person } from "@/lib/domain-types"
import { canReadForPerson } from "@/lib/permissions"
import type { AppSession } from "@/lib/session"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import TestChartScreen from "./TestChartScreen"
import type { Metadata } from "next"

export const metadata: Metadata = { title: "Test Result Chart" }

interface Props {
  params: Promise<{ personId: string }>
}

export default async function TestChartPage({ params }: Props) {
  const session = await auth() as AppSession | null
  if (!session) redirect("/login")

  const { personId } = await params
  const person = getDb()
    .prepare("SELECT * FROM people WHERE id = ? AND is_active = 1")
    .get(parseInt(personId)) as Person | undefined
  if (!person) notFound()
  if (!canReadForPerson(session.user?.groups ?? [], session.user, person.account_uid)) notFound()

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <AppHeader title="Test Result Chart" />
      <Suspense>
        <TestChartScreen personId={person.id} name={person.name} photoUrl={person.photo_url ?? null} color={person.color} />
      </Suspense>
      <AppFooter />
    </div>
  )
}
