// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { MAIN_CONTENT_ID } from "@/lib/a11y"

export default function SkipToContent() {
  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    const main = document.getElementById(MAIN_CONTENT_ID)
    if (!main) return
    e.preventDefault()
    main.focus({ preventScroll: true })
    main.scrollIntoView({ block: "start" })
  }

  return (
    <a href={`#${MAIN_CONTENT_ID}`} onClick={handleClick} className="skip-to-content">
      Skip to content
    </a>
  )
}
