# ADR-0016: App lock uses a device-bound credential, not a passkey

**Status:** Accepted (decided 2026-10-02); implemented, including the Diagnostics → App lock tool (footer link); device-verified on a Pixel 8 for an Entra Account in 1.1.0 (see the re-proof amendment for what is not)

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

## Amendment: privacy cover (October 2026)

**Status:** Accepted; implemented in 1.1.0.

App lock decided *whether to ask* on return, but nothing hid what was on screen: the previous screen could show for a frame or more before the lock overlay rendered, because the overlay mounts only after the page becomes visible again and React renders.

- **Decision.** A privacy cover, independent of the lock decision. When the page is hidden (`visibilitychange` to hidden, and `pagehide`), an attribute on `<html>` is set straight from the handler, not through React state, and CSS draws an opaque app-blue panel carrying only the app name. It is lifted two frames after the state machine's return decision (lock overlay if it locks, content if the grace period or suppression says not to), so a returning or restored page comes back already covered. It is always on whenever App lock is eligible and has no setting. It never grants or removes access, and the grace period, the camera and file picker suppression and who can unlock are unchanged. `lib/bio-lock-state.ts`'s pure state machine needed no change.
- **Known limit: the Android recents preview is not protected.** On a Pixel 8 (Chrome 154, installed app) the live app showed in the recents preview for every trigger tried, with the cover recorded as on at the hide event. Android takes its snapshot from the already-drawn frame before page script can react. Window `blur` fires about 60 to 120 ms before the page is hidden but did not change the result, so it is not used (it would also cover on address-bar and shade focus changes).
- **iOS is untested**, so nothing is claimed either way. Native options (Android's secure window flag, iOS lifecycle hooks) are deferred and not being pursued.
- **What it does achieve:** the flash of previous content on return is much shorter, and the camera and file picker round trips showed no visible regression (confirmed on a Pixel 8 with 1.1.0-alpha.7). A brief flash still remains on the installed app, and its cause was not investigated further.
- **Accepted as a partial mitigation.** Fully hiding the app in the recents preview and on return is not achievable from a PWA, so no further work is planned unless the app gains a native shell.

## Amendment: resetting the credential needs re-proof (October 2026)

**Status:** Accepted; implemented in 1.1.0. Device-verified on 1.1.0-alpha.17 for an Entra Account: normal unlock stays biometric-only, Reset asks for a forced Microsoft sign-in and does not set up yet, a wrong password or a cancel leaves the old credential, a correct re-proof reaches set-up, and Turn off still works. Not device-verified: the local-password variant, recovery after the device's biometrics change, and the first set-up gate.

The first version of this ADR kept "the user can reset a broken credential from the lock screen" as a safeguard. That reset cleared the stored credential id and opened set-up, and a successful set-up unlocks. Anyone who could pass the device's own check on a signed-in session could therefore replace the credential and unlock, with no server-verified proof, while turning App lock off already needed one.

- **Decision.** "Still not working? Reset and set up again" no longer touches the stored credential id directly. It opens the same re-proof panel as turning App lock off and calls `POST /api/me/app-lock/reauth-grant` unchanged: the current password (plus the authenticator code if enrolled) for a local Account, or a fresh forced Microsoft sign-in for an Entra Account. Only after the server grants it is the stored id cleared and set-up offered. The Entra return carries `appLockOptOut=reset` (turn-off keeps `1`) so the overlay knows which action to finish.
- **Recovery stays open.** A user whose credential died (Android drops platform credentials when the lock screen changes) can still recover by re-proving. The panel says why a password or Microsoft sign-in is needed. A failed or cancelled re-proof leaves the credential and the lock in place.
- **Set-up is gated too, with a recent sign-in as the exception (October 2026).** The first set-up on a device (a new device, cleared site data, or the one-time re-setup forced by the version marker) also needs a grant, because otherwise anyone who can open the device while the Account is signed in could enrol their own face or fingerprint as the lock. The grant is skipped when the user signed in recently: for a local Account the session carries `localAuthAt`, stamped in the jwt callback only on the password sign-in (session tokens are re-encoded on every request, so `iat` is not the sign-in time, and other providers clear it), and `POST /api/me/app-lock/reauth-grant` accepts `{recentSignIn: true}` with no password and grants only if `localAuthAt` is inside the same five-minute window as the Entra step-up (missing, non-finite and future-dated values are refused). Otherwise it answers 401 and the overlay shows the same re-proof panel as Reset (password and authenticator code, or a forced Microsoft sign-in tagged `appLockOptOut=setup`); an Entra Account uses the existing `auth_time` freshness check, so a fresh Microsoft sign-in needs no prompt. A session created before this change has no `localAuthAt` and asks for the password once. A refused or cancelled re-proof leaves the user on the lock screen with a button to try again. Enforcement of the credential itself is still client-side: the credential is local to the device and the server never sees it, so the server only verifies the grant. After a granted reset the overlay lets set-up run without asking again; a reload during set-up asks again (the grant is one-shot and nothing is stored server-side), which a recent sign-in or the password satisfies.
- **Unchanged.** The credential is still device-local and not server-bound, the opt-out flow is untouched, and Entra freshness is unchanged: it is decided from the id_token `auth_time` claim (see Entra freshness below). App lock remains a local convenience layer, not a server auth boundary.

## Entra freshness is the id_token `auth_time`

- **Decision.** For an Entra Account, "fresh sign-in" means the id_token `auth_time` claim (when the user last actually authenticated at Entra) is within the five-minute window. The time FamilyChart handled the sign-in no longer counts, because a silent SSO re-issue completes without any credential or presence proof and would otherwise satisfy the gate. The jwt callback converts `auth_time` to the session's `entraAuthTime`; `isEntraAppLockReauthFresh` checks it. The same helper gates App lock turn-off and reset, Person erase and Account removal.
- **Fails closed.** A missing, non-numeric or future-dated `auth_time` (beyond 60 seconds of clock skew; smaller skew is clamped to now) leaves `entraAuthTime` unset and step-up is refused with the existing "sign in again" message. Normal sign-in, and the separate session-lifetime bound, are unaffected.
- **Client unchanged.** The client still sends `prompt=login` and `max_age=0` on the step-up `signIn`, which makes Entra re-authenticate interactively and issue a new `auth_time`. Those parameters are a request, not the control: the server relies only on the claim.
- **Operator requirement.** The v2.0 id_token omits `auth_time` unless the app registration lists it as an optional claim (Token configuration → Add optional claim → ID → `auth_time`, then grant consent). Without it, normal sign-in works but every Entra step-up is refused until the claim is added.
- **Confirmed on a device (October 2026).** With the optional claim added, an Entra step-up straight after a fresh Microsoft sign-in is granted, so the registration emits `auth_time`.
- **Not done.** No dedicated server-side step-up flow bound to a state and nonce, and the five-minute window is unchanged.
