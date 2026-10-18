// SPDX-License-Identifier: AGPL-3.0-only

import type { ElementType, ReactNode } from "react"
import Surface from "./Surface"

/**
 * The light container for forms (the `surface-panel` colour), 16px padding. It declares a light
 * Surface, so fields and buttons inside take their light colours. Use `as="form"` for a form.
 */
export default function Panel({
  as,
  children,
  ...rest
}: { as?: ElementType; children: ReactNode } & Record<string, unknown>) {
  return (
    <Surface kind="light" as={as} className="fc-panel fc-form" {...rest}>
      {children}
    </Surface>
  )
}
