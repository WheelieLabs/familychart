// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import {
  useId,
  type AriaAttributes,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react"
import { announce } from "@/lib/announce"
import Button from "./Button"
import { useFieldContext } from "./FormField"

/**
 * Attributes a control takes from its FormField. A control with its own `aria-label` (the unit
 * selector in a compound control) names itself and takes no id from the field.
 */
function useFieldProps(own: { id?: string; "aria-label"?: string; "aria-describedby"?: string; "aria-invalid"?: AriaAttributes["aria-invalid"] }) {
  const field = useFieldContext()
  const named = !!own["aria-label"]
  return {
    id: own.id ?? (named ? undefined : field?.id),
    "aria-describedby": [own["aria-describedby"], field?.describedBy].filter(Boolean).join(" ") || undefined,
    "aria-invalid": own["aria-invalid"] ?? (field?.invalid ? true : undefined),
  }
}

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "style" | "type"> & {
  type?: "text" | "email" | "password" | "number" | "date" | "time" | "tel" | "url" | "search" | "datetime-local"
}

export function Input({ type = "text", ...rest }: InputProps) {
  const field = useFieldProps(rest)
  return <input {...rest} {...field} type={type} className="fc-field-control" />
}

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "style">

/** The native select with its native arrow. Give a unit selector `aria-label="Unit"`. */
export function Select({ children, ...rest }: SelectProps) {
  const field = useFieldProps(rest)
  return (
    <select {...rest} {...field} className="fc-field-control">
      {children}
    </select>
  )
}

export type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className" | "style">

export function Textarea(props: TextareaProps) {
  const field = useFieldProps(props)
  return <textarea {...props} {...field} className="fc-field-control" />
}

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "style" | "type" | "children"> & {
  label: ReactNode
}

/** A 24px box in a row that is one tappable label, at least 44px high on touch. */
export function Checkbox({ label, disabled, ...rest }: CheckboxProps) {
  return (
    <label className={`fc-check${disabled ? " fc-check--disabled" : ""}`}>
      <input {...rest} disabled={disabled} type="checkbox" />
      <span>{label}</span>
    </label>
  )
}

export interface ToggleProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  /** Why the switch is disabled, shown as text under it and tied to it for screen readers. */
  disabledReason?: string
  /** Helper text under the switch, tied to it for screen readers. */
  hint?: string
}

/** A switch tied to its visible label: announced as a switch with that name. 44px high on touch. */
export function Toggle({ label, checked, onChange, disabled, disabledReason, hint }: ToggleProps) {
  const labelId = useId()
  const switchId = useId()
  const reasonId = useId()
  const hintId = useId()
  const showReason = !!disabled && !!disabledReason
  return (
    <div>
      <div className={`fc-toggle${disabled ? " fc-toggle--disabled" : ""}`}>
        <label id={labelId} htmlFor={switchId} className="fc-toggle__label">{label}</label>
        <button
          id={switchId}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby={labelId}
          aria-describedby={[hint ? hintId : "", showReason ? reasonId : ""].filter(Boolean).join(" ") || undefined}
          disabled={disabled}
          className="fc-toggle__switch"
          onClick={() => onChange(!checked)}
        />
      </div>
      {hint && <p id={hintId} className="fc-field__hint">{hint}</p>}
      {showReason && <p id={reasonId} className="fc-field__hint">{disabledReason}</p>}
    </div>
  )
}

export interface FileInputProps {
  /** The files the picker offers, e.g. "application/pdf,image/jpeg". */
  accept?: string
  /** The chosen file, when the parent holds it. Leave out to let the control keep it. */
  file?: File | null
  onFileChange?: (file: File | null) => void
  disabled?: boolean
  /** Why the file cannot be chosen, shown as text beside the button. Required when disabled. */
  disabledReason?: string
  name?: string
  /** Runs just before the picker opens, e.g. to stop the app lock treating the picker as leaving the app. */
  onBeforeChoose?: () => void
}

/**
 * A "Choose file" button opens the picker. The real input stays in the page, visually hidden and
 * labelled by the field label. The chosen name is shown, the button then reads "Change file", and a
 * quiet "Remove" clears it. Choosing a file is announced. State accepted types and the size limit in
 * the FormField hint.
 */
export function FileInput({ accept, file: fileProp, onFileChange, disabled, disabledReason, name, onBeforeChoose }: FileInputProps) {
  const field = useFieldContext()
  const inputRef = useRef<HTMLInputElement>(null)
  const [own, setOwn] = useState<File | null>(null)
  const file = fileProp === undefined ? own : fileProp

  function choose(next: File | null) {
    setOwn(next)
    onFileChange?.(next)
    announce(next ? `File chosen: ${next.name}` : "File removed")
  }

  return (
    <div className="fc-file">
      <input
        ref={inputRef}
        type="file"
        id={field?.id}
        name={name}
        accept={accept}
        disabled={disabled}
        aria-describedby={field?.describedBy}
        aria-invalid={field?.invalid ? true : undefined}
        className="fc-visually-hidden"
        tabIndex={-1}
        onChange={event => choose(event.target.files?.[0] ?? null)}
      />
      {disabled ? (
        <Button variant="secondary" disabled disabledReason={disabledReason ?? "File upload is unavailable."}>
          {file ? "Change file" : "Choose file"}
        </Button>
      ) : (
        <Button variant="secondary" onClick={() => { onBeforeChoose?.(); inputRef.current?.click() }}>
          {file ? "Change file" : "Choose file"}
        </Button>
      )}
      <span className="fc-file__name">{file ? file.name : "No file chosen"}</span>
      {file && (
        <Button
          variant="quiet"
          onClick={() => {
            if (inputRef.current) inputRef.current.value = ""
            choose(null)
          }}
        >
          Remove
        </Button>
      )}
    </div>
  )
}
