// SPDX-License-Identifier: AGPL-3.0-only

import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { isAdmin } from "@/lib/permissions"
import type { AppSession } from "@/lib/session"

export default async function AdminExportLayout({ children }: { children: React.ReactNode }) {
  const session = await auth() as AppSession | null
  if (!session) redirect("/login")
  if (!isAdmin(session.user?.groups ?? [])) redirect("/denied")
  return <>{children}</>
}
