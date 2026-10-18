// SPDX-License-Identifier: AGPL-3.0-only
"use client"

import "./globals.css"
import ErrorScreen from "@/components/ErrorScreen"
import SkipToContent from "@/components/SkipToContent"

/** Replaces the root layout when the layout itself throws, so it carries its own `html` and `body`. */
export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-AU">
      <body className="flex h-full flex-col overflow-hidden [&>*]:min-h-0">
        <SkipToContent />
        <ErrorScreen {...props} />
      </body>
    </html>
  )
}
