// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Spread onto a `Button` that is sometimes unavailable: `<Button {...disabledWhen(busy && "Saving…")} />`.
 * A disabled `Button` must say why, so the reason travels with the flag.
 */
export function disabledWhen(
  reason: string | null | false | undefined,
): { disabled: true; disabledReason: string } | { disabled?: false; disabledReason?: undefined } {
  return reason ? { disabled: true, disabledReason: reason } : {}
}
