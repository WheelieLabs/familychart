// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { createContext, use, useId, type ReactNode } from "react"

interface FieldContextValue {
  /** The control's id, which the label points at. */
  id: string
  describedBy: string | undefined
  invalid: boolean
  required: boolean
}

const FieldContext = createContext<FieldContextValue | null>(null)

/** What a control needs from its field: id, `aria-describedby` and `aria-invalid`. */
export function useFieldContext(): FieldContextValue | null {
  return use(FieldContext)
}

interface FieldChromeProps {
  label: string
  /** Marks the field "(optional)". Fields are required unless marked. */
  optional?: boolean
  hint?: string
  error?: string
  id?: string
  children: ReactNode
}

function joinIds(...ids: (string | undefined)[]): string | undefined {
  const joined = ids.filter(Boolean).join(" ")
  return joined || undefined
}

function LabelText({ label, optional }: { label: string; optional?: boolean }) {
  return (
    <>
      {label}
      {optional && <span className="fc-field__optional"> (optional)</span>}
    </>
  )
}

function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className="fc-field__error">
      <span aria-hidden="true">⚠ </span>
      {children}
    </p>
  )
}

export type FormFieldProps = FieldChromeProps & {
  /** Stacked by default. Inline is for the Date and Time rows only (a fixed 72px label column). */
  layout?: "stacked" | "inline"
}

/**
 * A label, an optional hint, one control (or a compound control such as a value and its unit) and
 * an optional error. The controls in `components/ui` read the id, `aria-describedby` and
 * `aria-invalid` from here, so every control is programmatically labelled.
 */
export default function FormField({
  label,
  optional,
  hint,
  error,
  id: idProp,
  layout = "stacked",
  children,
}: FormFieldProps) {
  const autoId = useId()
  const id = idProp ?? autoId
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const value: FieldContextValue = {
    id,
    describedBy: joinIds(hint ? hintId : undefined, error ? errorId : undefined),
    invalid: !!error,
    required: !optional,
  }
  return (
    <FieldContext value={value}>
      <div className={`fc-field${layout === "inline" ? " fc-field--inline" : ""}`}>
        <label htmlFor={id} className="fc-field__label">
          <LabelText label={label} optional={optional} />
        </label>
        {hint && <p id={hintId} className="fc-field__hint">{hint}</p>}
        {children}
        {error && <FieldError id={errorId}>{error}</FieldError>}
      </div>
    </FieldContext>
  )
}

/**
 * A group of related controls (Administered by, Severity, filter options) as a `fieldset` whose
 * `legend` is styled as a field label. Hint and error describe the whole group.
 */
export function FieldGroup({ label, optional, hint, error, id: idProp, children }: FieldChromeProps) {
  const autoId = useId()
  const id = idProp ?? autoId
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  return (
    <fieldset
      className="fc-field"
      aria-describedby={joinIds(hint ? hintId : undefined, error ? errorId : undefined)}
    >
      <legend className="fc-field__label">
        <LabelText label={label} optional={optional} />
      </legend>
      {hint && <p id={hintId} className="fc-field__hint">{hint}</p>}
      {children}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </fieldset>
  )
}

/** Wraps several controls in a row: a value and its unit, or a related pair. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="fc-field__row">{children}</div>
}
