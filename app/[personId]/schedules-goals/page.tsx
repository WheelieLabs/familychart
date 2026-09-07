// SPDX-License-Identifier: AGPL-3.0-only

import { auth } from "@/lib/auth"
import { redirect, notFound } from "next/navigation"
import { getDb } from "@/lib/db"
import type { Person } from "@/lib/domain-types"
import { getObservationGoal } from "@/lib/observation/observation-goals"
import { canWriteForPerson, canReadForPerson } from "@/lib/permissions"
import { sessionAccountUids } from "@/lib/account/account-identity"
import type { AppSession } from "@/lib/session"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import SchedulesGoalsClient from "./SchedulesGoalsClient"

interface Props { params: Promise<{ personId: string }> }

export default async function SchedulesGoalsPage({ params }: Props) {
  const session = await auth() as AppSession | null
  if (!session) redirect("/login")
  const groups = session.user?.groups ?? []

  const { personId } = await params
  const db = getDb()
  const person = db
    .prepare("SELECT * FROM people WHERE id = ? AND is_active = 1")
    .get(parseInt(personId)) as Person | undefined
  if (!person) notFound()

  if (!canReadForPerson(groups, session.user, person.account_uid)) notFound()

  const canWrite = canWriteForPerson(groups, session.user, person.account_uid)

  const isSelfLinked =
    person.account_uid != null &&
    sessionAccountUids(session.user).includes(person.account_uid)
  const showPacingProfileNote =
    isSelfLinked && getObservationGoal(db, person.id, "Hydration") != null

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <AppHeader title="Schedules & Goals" />
      <SchedulesGoalsClient
        personId={person.id}
        name={person.name}
        photoUrl={person.photo_url ?? null}
        color={person.color}
        canWrite={canWrite}
        showPacingProfileNote={showPacingProfileNote}
      />
      <AppFooter />
    </div>
  )
}
