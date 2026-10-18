// SPDX-License-Identifier: AGPL-3.0-only

import type { ComponentPropsWithoutRef, ElementType } from "react"

export type SurfaceKind = "dark" | "light"

type SurfaceProps<T extends ElementType> = {
  /** Whether the region is a dark canvas or card, or a light banner. */
  kind: SurfaceKind
  /** Element to render. Defaults to `div`. */
  as?: T
} & Omit<ComponentPropsWithoutRef<T>, "kind" | "as">

/**
 * Declares a region dark or light. Shared controls read the choice through the `--fc-surface-*`
 * custom properties in `app/globals.css`, so they take no tone prop. A region with no declaration is
 * light. The `fc-surface-app` and `fc-surface-admin` canvases are already dark.
 */
export default function Surface<T extends ElementType = "div">({
  kind,
  as,
  ...rest
}: SurfaceProps<T>) {
  const Component: ElementType = as ?? "div"
  return <Component data-surface={kind} {...rest} />
}
