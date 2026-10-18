// SPDX-License-Identifier: AGPL-3.0-only

import Button from "@/components/ui/Button"

interface ManagementStickyAddProps {
  onClick: () => void
  children: React.ReactNode
}

/**
 * Sticky primary "Add" bar at the bottom of long management catalogue lists. Put it last inside the
 * `PageContainer`, which declares the dark surface the button reads its colours from.
 */
export default function ManagementStickyAdd({ onClick, children }: ManagementStickyAddProps) {
  return (
    <div className="fc-sticky-add">
      <Button fullWidth onClick={onClick}>
        {children}
      </Button>
    </div>
  )
}
