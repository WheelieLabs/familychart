// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared HTML-email shell, ported visually from familychart-admin's `src/emailTemplates.js`
 * (`shell()` / `firstLoginEmail()`) so the two products read as one family. Table-based
 * layout, inline styles only — no `<style>` blocks, no flexbox/border-radius reliance beyond
 * what admin's version already proves works in Outlook/OWA.
 *
 * The invite email (`inviteEmailHtml`) is the first consumer; future transactional email
 * templates (e.g. a Reports export) build on the same `shell`/`COLORS`.
 */

const WORDMARK_URL = "https://admin.familychart.app/email-assets/familychart.png"
const WORDMARK_W = 120
const WORDMARK_H = 26

const COLORS = {
  pageBg: "#e8eef3",
  card: "#ffffff",
  border: "#c8dce8",
  headerBg: "#C8DDEF",
  heroBg: "#174878",
  heroText: "#ffffff",
  heroSubtext: "#E8F1F8",
  body: "#1a2f42",
  bodyDim: "#5a7a96",
  ctaBg: "#f0b429",
  ctaText: "#1a2f42",
  footerBg: "#f7fafc",
  footerLink: "#2878b5",
  footerDim: "#8aacbf",
}

/** Escapes dynamic text (Person names, email addresses) before it's interpolated into HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function shell({
  heroHeading,
  heroBody,
  bodyHtml,
  footerHtml,
}: {
  heroHeading: string
  heroBody: string
  bodyHtml: string
  footerHtml: string
}): string {
  return `<!DOCTYPE html><html lang="en-AU"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${COLORS.pageBg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.pageBg}">
  <tr>
    <td align="center" style="padding:12px 16px 40px">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:8px">
        <tr>
          <td bgcolor="${COLORS.headerBg}" style="background:${COLORS.headerBg};padding:14px 28px">
            <img src="${WORDMARK_URL}" width="${WORDMARK_W}" height="${WORDMARK_H}" alt="FamilyChart" style="display:block;border:0;width:${WORDMARK_W}px;height:${WORDMARK_H}px">
          </td>
        </tr>
        <tr>
          <td bgcolor="${COLORS.heroBg}" style="background:${COLORS.heroBg};padding:28px 28px 24px">
            <p style="margin:0;font-family:Georgia,serif;font-size:26px;font-weight:700;line-height:32px;mso-line-height-rule:exactly;color:${COLORS.heroText}">${heroHeading}</p>
            ${heroBody ? `<p style="margin:12px 0 0;font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:22px;mso-line-height-rule:exactly;color:${COLORS.heroSubtext}">${heroBody}</p>` : ""}
          </td>
        </tr>
        <tr>
          <td style="padding:28px 28px 24px">
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td bgcolor="${COLORS.footerBg}" style="background:${COLORS.footerBg};padding:16px 28px;border-top:1px solid ${COLORS.border}">
            ${footerHtml}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body></html>`
}

function ctaButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0">
    <tr>
      <td bgcolor="${COLORS.ctaBg}" style="background:${COLORS.ctaBg};border-radius:4px;padding:12px 22px">
        <a href="${href}" style="color:${COLORS.ctaText};text-decoration:none;font-family:system-ui,-apple-system,sans-serif;font-size:15px;font-weight:700">${label}</a>
      </td>
    </tr>
  </table>`
}

function footerLinkFallback(href: string): string {
  return `<p style="margin:0 0 8px;font-family:system-ui,-apple-system,sans-serif;font-size:12px;line-height:1.5;color:${COLORS.bodyDim};word-break:break-all">If the button doesn't work, paste this into your browser:<br>
    <a href="${href}" style="color:${COLORS.footerLink}">${href}</a></p>
  <p style="margin:0;font-family:system-ui,-apple-system,sans-serif;font-size:11px;color:${COLORS.footerDim};text-align:center">familychart.app</p>`
}

function footerBrandOnly(): string {
  return `<p style="margin:0;font-family:system-ui,-apple-system,sans-serif;font-size:11px;color:${COLORS.footerDim};text-align:center">familychart.app</p>`
}

/** Which name to show for the invite's inviter, and how it was resolved (see `resolveInviterDisplay` in `lib/invite.ts`). */
export type InviterDisplay = { kind: "name"; value: string } | { kind: "email"; value: string }

/**
 * The invite body paragraph's wording, split around the inviter's name/email so the HTML
 * and plain-text renderers (this file's `inviteEmailHtml` and `lib/invite.ts`'s
 * `buildInviteEmail`) share one source of truth for the copy instead of each re-deriving it.
 */
export function inviterSentenceParts(inviter: InviterDisplay): { prefix: string; value: string; suffix: string } {
  return inviter.kind === "name"
    ? { prefix: "", value: inviter.value, suffix: " has invited you to join their family's FamilyChart instance." }
    : { prefix: "You've been invited by ", value: inviter.value, suffix: " to join a FamilyChart instance." }
}

const INVITE_CTA_SENTENCE = " Set a password to get started — this link expires in 7 days and can only be used once."

export function inviteEmailHtml({
  inviter,
  acceptUrl,
}: {
  inviter: InviterDisplay
  acceptUrl: string
}): string {
  const { prefix, value, suffix } = inviterSentenceParts(inviter)
  const paragraph = `${prefix}<strong>${escapeHtml(value)}</strong>${suffix}${INVITE_CTA_SENTENCE}`

  const bodyHtml = `<p style="margin:0 0 20px;font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:${COLORS.body}">${paragraph}</p>
    ${ctaButton("Accept invite", acceptUrl)}`

  return shell({
    heroHeading: "You're invited to FamilyChart",
    heroBody: "You've been invited to create a FamilyChart account",
    bodyHtml,
    footerHtml: footerLinkFallback(acceptUrl),
  })
}

export function testEmailHtml({ statusLine }: { statusLine: string }): string {
  const bodyHtml = `<p style="margin:0;font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:${COLORS.body}">${escapeHtml(statusLine)}</p>`

  return shell({
    heroHeading: "FamilyChart email test",
    heroBody: "",
    bodyHtml,
    footerHtml: footerBrandOnly(),
  })
}
