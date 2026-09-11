// SPDX-License-Identifier: AGPL-3.0-only

"use client"

interface ToggleProps {
  value: boolean
  onChange: (v: boolean) => void
  label?: string
  /** Accessible name when no visible label (e.g. inline switch beside custom content). */
  ariaLabel?: string
}

const switchFocusClass =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fc-blue"

export default function Toggle({ value, onChange, label, ariaLabel }: ToggleProps) {
  return (
    <div className="flex items-center justify-between">
      {label && <span className="font-bold text-gray-800">{label}</span>}
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={!label ? ariaLabel : undefined}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-7 w-14 shrink-0 cursor-pointer rounded-full
          border-2 border-transparent transition-colors duration-200 ${switchFocusClass}
          ${value ? "bg-fc-blue" : "bg-gray-300"}`}
      >
        <span className={`inline-block h-6 w-6 rounded-full bg-white shadow-lg
          transition-transform duration-200 ${value ? "translate-x-7" : "translate-x-0"}`} />
      </button>
    </div>
  )
}
