// SPDX-License-Identifier: AGPL-3.0-only

"use client"

export interface FcTabItem<T extends string = string> {
  value: T
  label: string
}

export function FcTabBar<T extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: readonly FcTabItem<T>[]
  active: T
  onSelect: (value: T) => void
}) {
  return (
    <div className="bg-fc-blue flex border-b border-fc-blue-mid shrink-0" role="tablist">
      {tabs.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={active === value}
          onClick={() => onSelect(value)}
          className={`flex-1 py-2 text-sm font-bold transition-colors
            ${active === value ? "bg-fc-blue-dark text-white" : "text-white/70 hover:text-white"}`}>
          {label}
        </button>
      ))}
    </div>
  )
}
