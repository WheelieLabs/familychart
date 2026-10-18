// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from "react"
import { mainContentTargetProps } from "@/lib/a11y"
import Breadcrumb from "./Breadcrumb"
import type { Crumb } from "@/lib/ui/breadcrumbs"

export type PageWidth = "page" | "full" | "narrow"
export type PageArea = "app" | "admin"

interface PageContainerProps {
  /** `app` is the user and management Canvas; `admin` is the darker admin Canvas. */
  area?: PageArea
  /**
   * `page` (768px, every screen, Admin included), `full` (no cap, unused for now) or `narrow` (448px: Login, Setup, invite and reset cards).
   */
  width?: PageWidth
  /** The Person header, first in the page content and above the trail. */
  header?: ReactNode
  /** The trail up the app's structure, ending in this page. Omit on Home, Profile, Favourites and the hubs. */
  trail?: readonly Crumb[]
  /** A tab strip (`FcTabBar`) pinned to the top of the page, inside the `main` landmark. */
  tabs?: ReactNode
  children: ReactNode
}

/**
 * The page body: the area's Canvas (already dark), the single `main` landmark and skip-link target,
 * and the width and spacing rules (16px gutter, 12px top, 32px bottom, 12px between blocks). A page
 * cannot set its own padding or width; the caps live in `--fc-page-width*` in `globals.css`.
 */
export default function PageContainer({ area = "app", width = "page", header, trail, tabs, children }: PageContainerProps) {
  return (
    <main {...mainContentTargetProps} className={`fc-main fc-scroll fc-surface-${area}`}>
      {tabs && <div className="fc-main__tabs">{tabs}</div>}
      <div className={`fc-page${width === "page" ? "" : ` fc-page--${width}`}`}>
        {header}
        {trail && <Breadcrumb trail={trail} />}
        {children}
      </div>
    </main>
  )
}
