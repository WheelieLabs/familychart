// SPDX-License-Identifier: AGPL-3.0-only

interface ManagementStickyAddProps {
  onClick: () => void
  children: React.ReactNode
}

/** Sticky primary "Add" CTA at the bottom of long management catalogue lists. */
export default function ManagementStickyAdd({ onClick, children }: ManagementStickyAddProps) {
  return (
    <div className="sticky bottom-0 z-[1] shrink-0 px-3 pb-3 pt-2 bg-gradient-to-t from-fc-blue from-70% to-transparent">
      <button
        type="button"
        onClick={onClick}
        className="w-full bg-white hover:bg-gray-100 active:bg-gray-200 rounded-xl py-4 text-fc-blue font-bold text-center transition-colors"
      >
        {children}
      </button>
    </div>
  )
}
