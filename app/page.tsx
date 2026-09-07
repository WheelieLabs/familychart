// SPDX-License-Identifier: AGPL-3.0-only

import { auth } from "@/lib/auth"
import { mainContentTargetProps } from "@/lib/a11y"
import { redirect } from "next/navigation"
import { getDb } from "@/lib/db"
import type { Person } from "@/lib/domain-types"
import { canManage, canReadForPerson, canWriteForPerson, hasAnyReadablePerson } from "@/lib/permissions"
import type { AppSession } from "@/lib/session"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import GettingStartedCard from "@/components/GettingStartedCard"
import HomePeopleList from "@/components/HomePeopleList"

interface Props {
  searchParams: Promise<{ welcome?: string }>
}

export default async function HomePage({ searchParams }: Props) {
  const sp = await searchParams
  const showWelcome = sp.welcome === "1"
  const session = await auth() as AppSession | null
  if (!session) redirect("/login")

  const db = getDb()
  const allPeople = db
    .prepare("SELECT * FROM people WHERE is_active = 1 ORDER BY sort_order, name")
    .all() as Person[]

  const userGroups = session.user?.groups ?? []
  if (!hasAnyReadablePerson(allPeople.map(p => p.account_uid), userGroups, session.user)) {
    redirect("/denied?reason=no-group")
  }

  const people = allPeople
    .filter(p => canReadForPerson(userGroups, session.user, p.account_uid))
    .map(p => ({
      ...p,
      canWrite: canWriteForPerson(userGroups, session.user, p.account_uid),
    }))

  const firstPersonId = people.length > 0 ? people[0].id : null
  const showManagementHints = canManage(userGroups)

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="FamilyChart" />
      <main {...mainContentTargetProps} className="fc-surface-app fc-scroll">
        <GettingStartedCard
          showWelcome={showWelcome}
          firstPersonId={firstPersonId}
          showManagementHints={showManagementHints}
        />
        <HomePeopleList people={people} />
      </main>
      <AppFooter />
    </div>
  )
}
