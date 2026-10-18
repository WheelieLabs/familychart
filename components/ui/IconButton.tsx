// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import Link from "next/link"
import type { ButtonHTMLAttributes, ReactNode } from "react"

type NativeProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className" | "style" | "aria-label">

export type IconButtonProps = NativeProps & {
  /** The accessible name. Required: an icon says nothing to a screen reader. */
  label: string
  /** The icon. It is hidden from screen readers; `label` names the control. */
  children: ReactNode
  href?: string
}

/** An icon-only control, 44px on touch and 36px with a mouse. Colours follow the Surface. */
export default function IconButton({ label, children, href, type = "button", ...native }: IconButtonProps) {
  if (!label.trim() && process.env.NODE_ENV !== "production") {
    throw new Error("IconButton: label is required so the control has an accessible name.")
  }
  const icon = <span aria-hidden="true">{children}</span>
  if (href && !native.disabled) {
    return (
      <Link href={href} aria-label={label} title={label} className="fc-icon-btn">
        {icon}
      </Link>
    )
  }
  return (
    <button {...native} type={type} aria-label={label} title={label} className="fc-icon-btn">
      {icon}
    </button>
  )
}
