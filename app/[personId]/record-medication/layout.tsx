// SPDX-License-Identifier: AGPL-3.0-only

import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getDb } from "@/lib/db"
import { canWriteForPerson } from "@/lib/permissions"
import type { AppSession } from "@/lib/session"

interface Props {
  children: React.ReactNode
  params: Promise<{ personId: string }>
}

export default async function RecordMedicationLayout({ children, params }: Props) {
  const session = await auth() as AppSession | null
  if (!session) redirect("/login")

  const { personId } = await params
  const person = getDb()
    .prepare("SELECT account_uid FROM people WHERE id = ? AND is_active = 1")
    .get(parseInt(personId)) as { account_uid: string | null } | undefined

  if (!person) redirect("/")

  if (!canWriteForPerson(session.user?.groups ?? [], session.user, person.account_uid)) {
    redirect("/denied")
  }

  return <Suspense>{children}</Suspense>
}
