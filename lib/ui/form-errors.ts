// SPDX-License-Identifier: AGPL-3.0-only

import { announce } from "@/lib/announce"

export interface FormProblems {
  count: number
  /** The first invalid field's label, or its name when it has none. */
  firstLabel: string
  /** "2 problems to fix. First: Name." */
  message: string
}

function labelFor(field: Element): string {
  const id = field.getAttribute("id")
  const label = id ? field.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`) : null
  const legend = field.closest("fieldset")?.querySelector("legend")
  const text = (label ?? legend)?.firstChild?.textContent ?? field.getAttribute("aria-label") ?? field.getAttribute("name") ?? ""
  return text.trim()
}

/** Reads the invalid fields in a form. Returns null when there are none. */
export function describeProblems(form: ParentNode): FormProblems | null {
  const invalid = Array.from(form.querySelectorAll<HTMLElement>('[aria-invalid="true"]'))
  if (invalid.length === 0) return null
  const firstLabel = labelFor(invalid[0])
  const count = invalid.length
  const noun = count === 1 ? "problem" : "problems"
  return { count, firstLabel, message: `${count} ${noun} to fix.${firstLabel ? ` First: ${firstLabel}.` : ""}` }
}

/**
 * After a failed submit: move focus to the first invalid field and announce the number of problems
 * and the first field, assertively. Call it once the errors have rendered. Returns whether there
 * was anything to focus.
 */
export function focusFirstInvalid(form: ParentNode): boolean {
  const problems = describeProblems(form)
  if (!problems) return false
  form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  announce(problems.message, "assertive")
  return true
}

/**
 * For a form that reports one problem at a time: focus the field with `fieldId` and announce
 * "1 problem to fix. First: <label>." assertively. Returns whether the field was found.
 */
export function reportProblem(fieldId: string, label: string): boolean {
  const field = document.getElementById(fieldId)
  field?.focus()
  announce(`1 problem to fix. First: ${label}.`, "assertive")
  return field != null
}
