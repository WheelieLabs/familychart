// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { cloneElement, useId, type ReactElement } from "react"

const labelClass = "text-sm font-bold text-gray-700 block mb-1"
const hintClass = "text-xs text-gray-500 mb-1"

interface FormFieldProps {
  label: string
  hint?: string
  /** Optional stable id; auto-generated when omitted */
  id?: string
  className?: string
  children: ReactElement<{ id?: string }>
}

/** Associates a visible label with a single form control via htmlFor/id. */
export default function FormField({ label, hint, id: idProp, className, children }: FormFieldProps) {
  const autoId = useId()
  const fieldId = idProp ?? autoId
  const control = cloneElement(children, { id: children.props.id ?? fieldId })
  const controlId = (control.props.id as string) ?? fieldId

  return (
    <div className={className}>
      <label htmlFor={controlId} className={labelClass}>
        {label}
      </label>
      {hint ? <p className={hintClass}>{hint}</p> : null}
      {control}
    </div>
  )
}
