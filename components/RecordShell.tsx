// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from "react"
import AppFooter from "@/components/AppFooter"
import { personTrail } from "@/lib/ui/breadcrumbs"
import AppHeader, { PersonHeader } from "@/components/AppHeader"
import Panel from "@/components/ui/Panel"
import PageContainer from "@/components/ui/PageContainer"
import type { Person } from "@/lib/domain-types"

/**
 * The page around a Record form: header, the "‹ Person name" back link to the hub, the person's
 * header, and the form on a light panel. The form's own fields go in `children`.
 */
export default function RecordShell({
  title,
  person,
  children,
}: {
  title: string
  person: Pick<Person, "id" | "name" | "photo_url" | "color">
  children: ReactNode
}) {
  return (
    <div className="flex flex-col flex-1">
      <AppHeader title={title} />
      <PageContainer
        header={<PersonHeader name={person.name} photoUrl={person.photo_url} color={person.color} />}
        trail={personTrail(person.id, person.name, { label: title })}
      >
        <Panel>{children}</Panel>
      </PageContainer>
      <AppFooter />
    </div>
  )
}

/** The page while the person or the form's options are still loading. */
export function RecordLoading({ title, children = "Loading…" }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col flex-1">
      <AppHeader title={title} />
      <PageContainer>
        <p className="fc-admin-note">{children}</p>
      </PageContainer>
      <AppFooter />
    </div>
  )
}
