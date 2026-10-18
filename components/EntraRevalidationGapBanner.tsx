// SPDX-License-Identifier: AGPL-3.0-only

import Link from "next/link"
import Banner from "@/components/ui/Banner"
import type { EntraRevalidationGap } from "@/lib/auth/entra-revalidation-gap"
import { formatCount } from "@/lib/format-count"

interface Props {
  gap: EntraRevalidationGap
  /** `full` on Entra Sessions; `compact` (shorter, with a link there) on the Administration overview. */
  variant: "full" | "compact"
  /** True when outbound email is not configured, so the email fallback to Admins cannot be sent. Shown on `full` only. */
  emailAlertsOff?: boolean
}

/**
 * Warns that Entra access is going unchecked. Push delivery stays on for those users (ADR-0009), so the
 * text names that exposure and the two fixes rather than leaving it hidden.
 */
export default function EntraRevalidationGapBanner({ gap, variant, emailAlertsOff }: Props) {
  const cause = gap.graphConfigured
    ? `${formatCount(gap.usersWithoutGroupData, "Entra user has", "Entra users have")} no group data`
    : "Microsoft Graph isn't configured"

  if (variant === "compact") {
    return (
      <Banner kind="warning">
        Entra access isn&apos;t being rechecked: {cause}. See <Link href="/admin/entra-sessions">Entra Sessions</Link> for what to do.
      </Banner>
    )
  }

  return (
    <Banner kind="warning">
      {cause}, so Entra access isn&apos;t being rechecked. Anyone who signed in with Microsoft keeps access, and
      keeps receiving medication reminders, until you revoke them or they unsubscribe. Either grant the Graph
      permissions User.Read.All and GroupMember.Read.All on the Entra app registration, or use Revoke when
      someone leaves.
      {emailAlertsOff && " Email alerts are off because outbound email is not configured."}
    </Banner>
  )
}
