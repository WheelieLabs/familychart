// SPDX-License-Identifier: AGPL-3.0-only

/** A proxy in front of a later restore may reject an upload larger than this. */
export const EXPORT_PROXY_WARNING_BYTES = 100 * 1024 * 1024

/** Whole megabytes, so "about 42 MB, including 38 MB of reports". */
export function formatExportSize(totalBytes: number, reportBytes: number): string {
  const mb = (bytes: number) => Math.round(bytes / (1024 * 1024))
  return `about ${mb(totalBytes)} MB, including ${mb(reportBytes)} MB of reports`
}

/** True when a later upload of this export may be rejected by a proxy. */
export function exportExceedsProxyWarning(totalBytes: number): boolean {
  return totalBytes > EXPORT_PROXY_WARNING_BYTES
}
