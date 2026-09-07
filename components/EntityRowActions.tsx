// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react"

/** List rows on tinted / admin surfaces (`bg-white/10`, etc.): secondary edit control */
export const entityRowEditButtonClass =
  "inline-flex items-center justify-center min-h-[44px] px-2 rounded-lg " +
  "text-white hover:text-white hover:bg-white/10 text-sm shrink-0 transition-colors"

/** Same surfaces: destructive text label */
export const entityRowDeleteTextButtonClass =
  "inline-flex items-center justify-center min-h-[44px] px-2 rounded-lg " +
  "text-red-300 hover:text-red-100 hover:bg-red-500/15 text-sm shrink-0 leading-none transition-colors"

/** Same surfaces: compact ✕ remove (list rows use flex gap; no extra margin) */
export const entityRowDeleteIconButtonClass =
  `${entityRowDeleteTextButtonClass}`

/** Light panel rows: bordered destructive action (“Remove”, “Remove from list”) */
export const panelOutlineDestructiveButtonClass =
  "shrink-0 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-bold text-red-700 " +
  "hover:bg-red-50 transition-colors"

/** Modal / white list rows: inline ✕ to remove a row item (rules, etc.) */
export const modalRowRemoveIconButtonClass =
  "text-red-400 hover:text-red-600 ml-2 shrink-0 leading-none transition-colors"

/** Dismiss control on a filled pill (e.g. custom schedule time) */
export const scheduleChipDismissButtonClass =
  "rounded-md px-2 py-0.5 hover:bg-white/20 text-lg leading-none transition-colors"

/** Catalogue list: inactive medication badge */
export const inactiveCatalogBadgeClass =
  "text-sm bg-white/20 text-white rounded px-1.5 py-0.5 shrink-0"

function mergeBtn(
  base: string,
  className: string | undefined,
  disabled: boolean | undefined,
): string {
  return [base, disabled ? "opacity-40 pointer-events-none" : "", className].filter(Boolean).join(" ")
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement>

/** Edit on tinted management/admin list rows */
export function EntityRowEditButton({ className, children = "Edit", ...rest }: BtnProps) {
  return (
    <button type="button" className={mergeBtn(entityRowEditButtonClass, className, rest.disabled)} {...rest}>
      {children}
    </button>
  )
}

/** Delete on tinted rows — full word or ✕ icon */
export function EntityRowDeleteButton({
  variant = "text",
  className,
  children,
  "aria-label": ariaLabel,
  ...rest
}: BtnProps & { variant?: "text" | "icon" }) {
  const base = variant === "icon" ? entityRowDeleteIconButtonClass : entityRowDeleteTextButtonClass
  const label = children ?? (variant === "icon" ? "✕" : "Delete")
  return (
    <button
      type="button"
      className={mergeBtn(base, className, rest.disabled)}
      aria-label={ariaLabel ?? (variant === "icon" ? "Delete" : undefined)}
      {...rest}
    >
      {label}
    </button>
  )
}

/** fc-panel section: primary outline remove (expectations, person medications, …) */
export function PanelOutlineRemoveButton({ className, children, ...rest }: BtnProps & { children: ReactNode }) {
  return (
    <button type="button" className={mergeBtn(panelOutlineDestructiveButtonClass, className, rest.disabled)} {...rest}>
      {children}
    </button>
  )
}

/** Rule rows inside modals: trailing ✕ */
export function ModalRowRemoveIconButton({
  className,
  "aria-label": ariaLabel = "Remove",
  ...rest
}: BtnProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={mergeBtn(modalRowRemoveIconButtonClass, className, rest.disabled)}
      {...rest}
    >
      ✕
    </button>
  )
}

/** × on a coloured schedule chip — default accessible name is "Dismiss"; override with aria-label when context helps (e.g. time). */
export function ScheduleChipDismissButton({
  className,
  "aria-label": ariaLabel = "Dismiss",
  ...rest
}: BtnProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={mergeBtn(scheduleChipDismissButtonClass, className, rest.disabled)}
      {...rest}
    >
      ×
    </button>
  )
}

/** Medication catalogue: small status pill */
export function InactiveCatalogBadge({ className, children = "Inactive", ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={[inactiveCatalogBadgeClass, className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </span>
  )
}

/** Medication modal: toggle Active vs Inactive catalogue visibility */
export function CatalogActiveStatusButton({
  active,
  className,
  ...rest
}: Omit<BtnProps, "children"> & { active: boolean }) {
  const stateClass = active
    ? "bg-green-100 text-green-700 hover:bg-green-200"
    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
  return (
    <button
      type="button"
      className={mergeBtn(`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${stateClass}`, className, rest.disabled)}
      {...rest}
    >
      {active ? "Active" : "Inactive"}
    </button>
  )
}
