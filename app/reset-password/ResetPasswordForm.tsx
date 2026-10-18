// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import TokenPasswordForm from "@/components/TokenPasswordForm"

interface ResetPasswordFormProps {
  passwordMinLength: number
}

export default function ResetPasswordForm({ passwordMinLength }: ResetPasswordFormProps) {
  return (
    <TokenPasswordForm
      apiUrl="/api/auth/reset-password"
      passwordMinLength={passwordMinLength}
      heading="Set your password"
      subheading="Choose a password for your FamilyChart account."
      linkNoun="reset link"
      submitLabel="Set password and sign in"
      submittingLabel="Please wait…"
    />
  )
}
