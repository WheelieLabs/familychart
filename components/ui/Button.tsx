// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import Link from "next/link"
import { announce } from "@/lib/announce"
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type MouseEventHandler,
  type ReactNode,
} from "react"

export type ButtonVariant = "primary" | "secondary" | "destructive" | "quiet"
export type ButtonSize = "default" | "compact"

interface ButtonBaseProps {
  variant?: ButtonVariant
  /** Default (44px on touch, 36px on a mouse) or Compact (32px, for secondary controls on dense admin tools). */
  size?: ButtonSize
  /** Renders a link with the same look. */
  href?: string
  /** After a saving click: the label becomes `pendingLabel`, the width is kept and further clicks are ignored. */
  pending?: boolean
  pendingLabel?: string
  fullWidth?: boolean
  children: ReactNode
}

type NativeProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled" | "children" | "className" | "style">

/**
 * A button that is disabled must say why, in text beside it. The type refuses `disabled` without
 * `disabledReason`; the component also throws outside production for callers that bypass types.
 */
type DisabledProps =
  | { disabled?: false; disabledReason?: undefined }
  | { disabled: true; disabledReason: string }

export type ButtonProps = ButtonBaseProps & DisabledProps & NativeProps

function classes(variant: ButtonVariant, size: ButtonSize, fullWidth: boolean | undefined, pending: boolean | undefined) {
  return [
    "fc-btn",
    `fc-btn--${variant}`,
    size === "compact" ? "fc-btn--compact" : "",
    fullWidth ? "fc-btn--full" : "",
    pending ? "fc-btn--pending" : "",
  ].filter(Boolean).join(" ")
}

/**
 * In development, a destructive button directly on the plain canvas is a mistake: the action belongs
 * in a confirm modal. Cards (`data-card`) and light regions are fine.
 */
function useCanvasDestructiveCheck(variant: ButtonVariant) {
  const ref = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || variant !== "destructive" || !ref.current) return
    const owner = ref.current.closest(
      '[data-card], [data-surface="light"], [data-surface="dark"], .fc-surface-app, .fc-surface-admin',
    )
    if (owner && !owner.hasAttribute("data-card") && owner.getAttribute("data-surface") !== "light") {
      console.error(
        "Button: a destructive button sits directly on the canvas. Move the action into a confirm modal, or put the button on a Card.",
      )
    }
  }, [variant])
  return ref
}

export default function Button(props: ButtonProps) {
  const {
    variant = "primary",
    size = "default",
    href,
    pending,
    pendingLabel = "Saving…",
    fullWidth,
    disabled,
    disabledReason,
    children,
    type = "button",
    onClick,
    ...native
  } = props
  const reasonId = useId()
  const ref = useCanvasDestructiveCheck(variant)

  // The result of a saving click is announced once it is pending; the caller announces the outcome.
  useEffect(() => {
    if (pending) announce(pendingLabel, "polite")
  }, [pending, pendingLabel])

  if (disabled && !disabledReason && process.env.NODE_ENV !== "production") {
    throw new Error("Button: a disabled button needs a disabledReason, shown as text so the person knows what to do next.")
  }

  const className = classes(variant, size, fullWidth, pending)
  const label = pending ? (
    <span className="fc-btn__stack">
      <span data-hidden="true" aria-hidden="true">{children}</span>
      <span>{pendingLabel}</span>
    </span>
  ) : (
    children
  )

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (pending) {
      event.preventDefault()
      return
    }
    onClick?.(event)
  }

  if (href && !disabled) {
    return (
      <Link
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={href}
        className={className}
        aria-describedby={native["aria-describedby"]}
        onClick={onClick as unknown as MouseEventHandler<HTMLAnchorElement> | undefined}
      >
        {children}
      </Link>
    )
  }

  const button = (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      {...native}
      type={type}
      className={className}
      disabled={disabled}
      aria-disabled={pending ? true : undefined}
      aria-busy={pending ? true : undefined}
      aria-describedby={disabled ? [native["aria-describedby"], reasonId].filter(Boolean).join(" ") : native["aria-describedby"]}
      onClick={handleClick}
    >
      {label}
    </button>
  )

  if (!disabled) return button

  return (
    <span className={`fc-btn-with-reason${fullWidth ? " fc-btn--full" : ""}`}>
      {button}
      <span id={reasonId} className="fc-btn-reason">{disabledReason}</span>
    </span>
  )
}
