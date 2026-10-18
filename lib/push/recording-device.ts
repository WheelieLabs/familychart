// SPDX-License-Identifier: AGPL-3.0-only

/** Request header naming the recording device by its push subscription endpoint. */
export const RECORDING_ENDPOINT_HEADER = "x-fc-push-endpoint"

const MAX_ENDPOINT_LENGTH = 2048

/**
 * The device that made a change, so its own copy of a notification is left for it to update or
 * close rather than being replaced by a push. Used only to skip that device when sending; it is
 * never stored or logged. Null when absent or not an https URL.
 */
export function recordingEndpointFromRequest(request: { headers: Headers }): string | null {
  const raw = request.headers.get(RECORDING_ENDPOINT_HEADER)?.trim()
  if (!raw || raw.length > MAX_ENDPOINT_LENGTH || !raw.startsWith("https://")) return null
  return raw
}
