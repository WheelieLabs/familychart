// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import { createPortal } from "react-dom"

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Tracks nested/stacked focus traps (e.g. a rule-editor Modal opened on top of
// an Edit Medication Modal) so only the topmost one reacts to Escape/Tab —
// otherwise Escape on an inner dialog would also close the outer one.
let trapStack: symbol[] = []

/**
 * Traps Tab focus within `containerRef` while `active`, moves focus into the
 * container on activation, and restores focus to whatever was focused before
 * activation once it goes inactive (or the component unmounts).
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  options?: { onEscape?: () => void; initialFocusRef?: RefObject<HTMLElement | null> },
): void {
  const onEscapeRef = useRef(options?.onEscape)
  useEffect(() => {
    onEscapeRef.current = options?.onEscape
  })
  const initialFocusRef = options?.initialFocusRef
  const stackIdRef = useRef<symbol | undefined>(undefined)
  if (stackIdRef.current === undefined) stackIdRef.current = Symbol("focus-trap")
  const stackId = stackIdRef.current

  useLayoutEffect(() => {
    if (!active) return
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const target =
      initialFocusRef?.current ?? containerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    target?.focus()
    return () => {
      returnTo?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => {
    if (!active) return
    trapStack.push(stackId)
    return () => {
      trapStack = trapStack.filter(id => id !== stackId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => {
    if (!active) return
    function isTopmost(): boolean {
      return trapStack[trapStack.length - 1] === stackId
    }
    function onKeyDown(e: KeyboardEvent) {
      if (!isTopmost()) return
      if (e.key === "Escape") {
        onEscapeRef.current?.()
        return
      }
      if (e.key !== "Tab") return
      const focusables = containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      if (!focusables || focusables.length === 0) return
      const list = Array.from(focusables)
      const first = list[0]
      const last = list[list.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}

export default function Modal({
  open,
  onClose,
  title,
  children,
  panelClassName = "bg-fc-panel rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4 max-h-[90vh] overflow-y-auto",
  backdropClassName = "fixed inset-0 z-50 bg-black/60 flex items-end justify-center p-4",
  titleClassName = "font-bold text-gray-800 text-xl",
  closeOnEscape = true,
  backdropDismiss = true,
  initialFocusRef,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  /** Tailwind classes for the dialog panel itself. */
  panelClassName?: string
  /** Tailwind classes for the fullscreen portal backdrop (controls stacking via z-*). */
  backdropClassName?: string
  /** Tailwind classes for the dialog's <h2> title. */
  titleClassName?: string
  /** When false, Escape does not call onClose. */
  closeOnEscape?: boolean
  /** When false, clicking the backdrop does not call onClose. */
  backdropDismiss?: boolean
  /** Element to focus when the modal opens, instead of the first focusable child. */
  initialFocusRef?: RefObject<HTMLElement | null>
}) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useFocusTrap(dialogRef, open, {
    onEscape: closeOnEscape ? onClose : undefined,
    initialFocusRef,
  })

  if (!mounted || !open) return null

  return createPortal(
    <div className={backdropClassName} role="presentation" onClick={backdropDismiss ? onClose : undefined}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}
        className={panelClassName}
      >
        <h2 id={titleId} className={titleClassName}>
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  )
}
