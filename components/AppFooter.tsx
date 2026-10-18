// SPDX-License-Identifier: AGPL-3.0-only

import { APP_VERSION } from "@/lib/version"
import DemoVersionBadge from "@/components/DemoVersionBadge"
import DiagnosticsLink from "@/components/DiagnosticsLink"

const PUBLIC_REPO = "https://github.com/WheelieLabs/familychart"
const SOURCE_URL = `${PUBLIC_REPO}/tree/v${APP_VERSION}`
const NOTICES_URL = `${PUBLIC_REPO}/blob/v${APP_VERSION}/THIRD-PARTY-NOTICES.md`

const AGPL_LINK = (
  <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer">
    AGPL-3.0
  </a>
)

/** `showDiagnostics` is false on the App lock screen, which must not link past the lock. */
export default function AppFooter({ showDiagnostics = true }: { showDiagnostics?: boolean }) {
  return (
    <footer className="fc-footer" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
      <p className="fc-footer__links">
        <span>Version {APP_VERSION}</span>
        <DemoVersionBadge />
        <span aria-hidden="true">·</span>
        <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
          Source
        </a>
        <span aria-hidden="true">·</span>
        <a href={NOTICES_URL} target="_blank" rel="noopener noreferrer">
          Licences
        </a>
        {showDiagnostics && <DiagnosticsLink />}
      </p>
      <p className="fc-footer__legal">
        <span className="fc-footer__legal-short">© {new Date().getFullYear()} WheelieLabs · {AGPL_LINK}</span>
        <span className="fc-footer__legal-full">
          © {new Date().getFullYear()} Benjamin Horder (trading as WheelieLabs). Licensed under {AGPL_LINK}
        </span>
      </p>
    </footer>
  )
}
