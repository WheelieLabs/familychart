// SPDX-License-Identifier: AGPL-3.0-only

import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Welcome to FamilyChart",
  description: "Set up FamilyChart for your household's medications and health observations.",
}

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return children
}
