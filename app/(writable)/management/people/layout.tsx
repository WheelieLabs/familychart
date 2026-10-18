// SPDX-License-Identifier: AGPL-3.0-only

import type { Metadata } from "next"

export const metadata: Metadata = { title: "People" }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
