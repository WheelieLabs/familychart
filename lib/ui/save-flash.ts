// SPDX-License-Identifier: AGPL-3.0-only

const KEY = "fc-save-flash"

/**
 * A one-time message carried across the redirect after a save, in session storage rather than the
 * URL, so a reload or a shared link never replays it. The person hub takes it on load.
 */
export function setSaveFlash(message: string): void {
  try {
    sessionStorage.setItem(KEY, message)
  } catch {
    // Storage can be blocked; the save itself has already succeeded, so the flash is just skipped.
  }
}

/** Reads the message and removes it, so it shows once. Null when there is none. */
export function takeSaveFlash(): string | null {
  try {
    const message = sessionStorage.getItem(KEY)
    if (message !== null) sessionStorage.removeItem(KEY)
    return message
  } catch {
    return null
  }
}
