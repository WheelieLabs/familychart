// SPDX-License-Identifier: AGPL-3.0-only

import AdminExportPage from "./export-page"
import { restoreMaxUploadBytes } from "@/lib/restore/stage-store"

export default function ExportRoute() {
  const maxUploadMb = Math.round(restoreMaxUploadBytes() / (1024 * 1024))
  return <AdminExportPage maxUploadMb={maxUploadMb} />
}
