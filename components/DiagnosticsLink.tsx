// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import Link from "next/link"
import { useSession } from "next-auth/react"

/** Footer link to the Diagnostics area; only for a signed-in Account. */
export default function DiagnosticsLink() {
  const { status } = useSession()
  if (status !== "authenticated") return null
  return (
    <>
      <span aria-hidden="true">·</span>
      <Link href="/diagnostics" className="underline hover:text-gray-600">
        Diagnostics
      </Link>
    </>
  )
}
