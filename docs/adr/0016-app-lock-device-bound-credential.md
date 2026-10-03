# ADR-0016: App lock uses a device-bound credential, not a passkey

**Status:** Accepted (decided 2026-10-02); implemented, including the Diagnostics → App lock tool (footer link); manual device verification outstanding

## Context

App lock re-verifies the device's owner with WebAuthn. From v0.26.0 it created a non-discoverable platform credential, and on Android Chrome that gave the system biometric prompt alone. In September 2026 `get()` began failing right after a successful `create()` on the maintainer's Pixel devices. No FamilyChart change caused it, and the platform cause was never identified. The v1.0.2–v1.0.5 workarounds switched to `residentKey: "preferred"` and an 8 s ceremony timeout. "Preferred" asks for a discoverable credential (a passkey). Chrome for Android routes those through Credential Manager to the user's passkey provider (Google Password Manager or a third-party password manager), and the provider always shows a picker. The 8 s timeout then cut off the provider's own unlock, causing a re-pick loop. An on-device probe in October 2026 showed `residentKey: "discouraged"` once again gives biometric-only unlock in about 3 s. That held in a tab and in the installed app, whether or not the Google provider was enabled. Chromium's source confirms that "discouraged" is the only `create()` option that keeps the ceremony on the device-bound Play services path.

## Decision

- App lock creates a **non-discoverable, device-bound credential** (`residentKey: "discouraged"`, platform attachment, user verification required) and unlocks with an allow-list `get()`. It does not use passkeys. Synced or provider passkeys always add a picker, which defeats a quick re-verification.
- Credentials created under the passkey options are treated as "not set up". A version marker on the stored credential ID forces a one-time re-setup per device.
- Safeguards kept, because the September trigger is unexplained:
  - setup verifies the new credential with a real `get()` before saving it
  - the user can reset a broken credential from the lock screen
  - error messages carry the real DOMException name
  - ceremony failures are logged to the server (error name, elapsed time, user agent; no credential data)
- The ceremony has the WebAuthn 60 s `timeout`, a safety net just above it (about 65 s) for promises that never settle, and a visible Cancel. A short cutoff is rejected.
- User-facing copy says **App lock** and "Unlock with your device", described as using fingerprint, face, or screen lock. It doesn't promise biometrics, because Android may accept the screen-lock PIN or pattern instead.

## Considered options

- **Keep passkeys and fix only the timeout.** Rejected: the provider picker remains on every unlock.
- **Native biometric API through a native app shell.** Not needed for this problem. It remains relevant to a future native app.
