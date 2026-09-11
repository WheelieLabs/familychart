// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import TokenPasswordForm from "@/components/TokenPasswordForm"

interface AcceptInviteFormProps {
  passwordMinLength: number
}

export default function AcceptInviteForm({ passwordMinLength }: AcceptInviteFormProps) {
  return (
    <TokenPasswordForm
      apiUrl="/api/accounts/invites/accept"
      passwordMinLength={passwordMinLength}
      heading="Set your password"
      subheading="Choose a password to finish setting up your FamilyChart account."
      invalidTokenMessage="This invite link is invalid or has expired. Ask your administrator to send a new one."
      submitLabel="Set password and sign in"
      submittingLabel="Please wait…"
    />
  )
}
