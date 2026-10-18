// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useState, type FormEventHandler, type ReactNode } from "react"
import { Checkbox, Input } from "@/components/ui/controls"
import FormField from "@/components/ui/FormField"
import PageContainer from "@/components/ui/PageContainer"
import Panel from "@/components/ui/Panel"

/**
 * The sign-in family of pages (Login, Setup, invite and reset): the logo and heading on the canvas,
 * then the form in a light card, all in the narrow 448px container.
 */
export default function AuthShell({
  heading,
  subheading,
  children,
}: {
  heading: string
  subheading?: string
  children: ReactNode
}) {
  return (
    <PageContainer width="narrow">
      <div className="fc-auth__brand" aria-hidden="true">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z" />
        </svg>
      </div>
      <div className="fc-auth__titles">
        <h2 className="fc-auth__heading">{heading}</h2>
        {subheading && <p className="fc-auth__sub">{subheading}</p>}
      </div>
      {children}
    </PageContainer>
  )
}

/** The light card that holds an auth form. Pass `onSubmit` to make it a form. */
export function AuthCard({
  onSubmit,
  children,
}: {
  onSubmit?: FormEventHandler<HTMLFormElement>
  children: ReactNode
}) {
  return onSubmit ? (
    <Panel as="form" onSubmit={onSubmit}>{children}</Panel>
  ) : (
    <Panel>{children}</Panel>
  )
}

/**
 * A password field with a "Show password" checkbox under it. The box is off by default and only
 * switches the input's type, so pasting and password managers are never blocked.
 */
export function PasswordField({
  label,
  value,
  onChange,
  hint,
  error,
  id,
  autoComplete,
  minLength,
  required = true,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  error?: string
  id?: string
  autoComplete: string
  minLength?: number
  required?: boolean
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="fc-form" style={{ gap: 4 }}>
      <FormField label={label} optional={!required} hint={hint} error={error} id={id}>
        <Input
          type={show ? "text" : "password"}
          value={value}
          onChange={e => onChange(e.target.value)}
          autoComplete={autoComplete}
          minLength={minLength}
          required={required}
        />
      </FormField>
      <Checkbox label="Show password" checked={show} onChange={e => setShow(e.target.checked)} />
    </div>
  )
}
