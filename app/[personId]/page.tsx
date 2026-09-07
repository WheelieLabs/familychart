// SPDX-License-Identifier: AGPL-3.0-only

import { auth } from "@/lib/auth"
import { redirect, notFound } from "next/navigation"
import { getDb } from "@/lib/db"
import type { Person } from "@/lib/domain-types"
import { canWriteForPerson, canReadForPerson } from "@/lib/permissions"
import { sessionAccountUids } from "@/lib/account/account-identity"
import type { AppSession } from "@/lib/session"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import PersonPageActions from "@/components/PersonPageActions"

interface Props { params: Promise<{ personId: string }> }

export default async function PersonActionsPage({ params }: Props) {
  const session = await auth() as AppSession | null
  if (!session) redirect("/login")

  const { personId } = await params
  const db = getDb()
  const person = db
    .prepare("SELECT * FROM people WHERE id = ? AND is_active = 1")
    .get(parseInt(personId)) as Person | undefined
  if (!person) notFound()

  const userGroups       = session.user?.groups ?? []
  const userCanWrite     = canWriteForPerson(userGroups, session.user, person.account_uid)
  const userCanRead      = canReadForPerson(userGroups, session.user, person.account_uid)

  if (!userCanRead) notFound()

  const isLinkedViewer =
    person.account_uid != null &&
    person.account_uid.trim() !== "" &&
    sessionAccountUids(session.user).includes(person.account_uid.trim())

  return (
    <div className="flex flex-col flex-1 bg-fc-blue">
      <AppHeader title="Select an Action" />
      <PersonPageActions
        personId={person.id}
        name={person.name}
        photoUrl={person.photo_url}
        color={person.color}
        canWrite={userCanWrite}
        isLinkedViewer={isLinkedViewer}
      />
      <AppFooter />
    </div>
  )
}
