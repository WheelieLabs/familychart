// SPDX-License-Identifier: AGPL-3.0-only

import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { canManage } from "@/lib/permissions"
import type { AppSession } from "@/lib/session"

/** Shared gate for `/management/*` and `/admin/*` (except routes that add their own checks). */
export default async function WritableLayout({ children }: { children: React.ReactNode }) {
  const session = await auth() as AppSession | null
  if (!session) redirect("/login")
  if (!canManage(session.user?.groups ?? [])) redirect("/denied")
  return <>{children}</>
}
