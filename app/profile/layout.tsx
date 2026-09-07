// SPDX-License-Identifier: AGPL-3.0-only

import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Profile",
  description: "Your FamilyChart profile, security, and linked family member.",
}

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children
}
