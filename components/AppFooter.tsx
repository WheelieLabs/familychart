// SPDX-License-Identifier: AGPL-3.0-only

import { APP_VERSION } from "@/lib/version"
import DemoVersionBadge from "@/components/DemoVersionBadge"

const PUBLIC_REPO = "https://github.com/WheelieLabs/familychart"
const SOURCE_URL = `${PUBLIC_REPO}/tree/v${APP_VERSION}`
const NOTICES_URL = `${PUBLIC_REPO}/blob/v${APP_VERSION}/THIRD-PARTY-NOTICES.md`

export default function AppFooter() {
  return (
    <footer
      className="bg-fc-header px-4 pt-2 shrink-0 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sticky bottom-0 z-10"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      <span className="text-xs text-gray-500 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span>Version {APP_VERSION}</span>
        <DemoVersionBadge />
        <span aria-hidden="true" className="hidden sm:inline">·</span>
        <a
          href={SOURCE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-gray-600"
        >
          Source
        </a>
        <span aria-hidden="true">·</span>
        <a
          href={NOTICES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-gray-600"
        >
          Third-party licenses
        </a>
      </span>
      <span className="text-xs text-gray-400">
        © {new Date().getFullYear()} Benjamin Horder (trading as WheelieLabs). Licensed under{" "}
        <a
          href="https://www.gnu.org/licenses/agpl-3.0.html"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-gray-600"
        >
          AGPL-3.0
        </a>
      </span>
    </footer>
  )
}
