// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { announce } from "@/lib/announce"
import { formatSecret, otpauthSecret } from "@/lib/mfa-secret"
import Button from "@/components/ui/Button"

interface AuthenticatorEnrolmentProps {
  qr: string | null
  otpauth: string | null
}

/**
 * The "add this to your authenticator" step: QR code, the secret to type in by hand, and an
 * otpauth link. The link only works where an authenticator app has registered for otpauth://
 * (many phones and browsers have none), so the typed secret is the dependable route.
 */
export default function AuthenticatorEnrolment({ qr, otpauth }: AuthenticatorEnrolmentProps) {
  const secret = otpauthSecret(otpauth)

  async function copy() {
    if (!secret) return
    try {
      await navigator.clipboard.writeText(secret)
      announce("Key copied")
    } catch {
      announce("Could not copy the key.", "assertive")
    }
  }

  return (
    <>
      {qr && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt="QR code" className="fc-qr" />
      )}
      {secret && (
        <>
          <p className="fc-section-copy">
            Can&apos;t scan the code? In your authenticator app choose &ldquo;Enter a setup key&rdquo; and type this key
            (time-based):
          </p>
          <p className="fc-section-copy"><code>{formatSecret(secret)}</code></p>
          <div>
            <Button variant="secondary" onClick={copy}>Copy key</Button>
          </div>
        </>
      )}
      {otpauth && (
        <p className="fc-section-copy">
          On your phone you can also try{" "}
          <a href={otpauth} className="fc-link">opening this in your authenticator app</a>. If nothing happens, use the
          key above.
        </p>
      )}
    </>
  )
}
