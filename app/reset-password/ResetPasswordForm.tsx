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
      invalidTokenMessage="This reset link is invalid or has expired. Ask your administrator to send a new one."
      submitLabel="Set password and sign in"
      submittingLabel="Please wait…"
    />
  )
}
