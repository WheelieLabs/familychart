// SPDX-License-Identifier: AGPL-3.0-only

import ErasePersonPage from "./ErasePersonPage"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ErasePersonPage personId={id} />
}
