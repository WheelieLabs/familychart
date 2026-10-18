// SPDX-License-Identifier: AGPL-3.0-only
"use client"

import ErrorScreen from "@/components/ErrorScreen"

export default function ErrorPage(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen {...props} />
}
