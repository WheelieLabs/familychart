// SPDX-License-Identifier: AGPL-3.0-only

import type { Metadata, Viewport } from "next"

import "./globals.css"
import AppLockProvider from "@/components/AppLockProvider"
import DeployRefresh from "@/components/DeployRefresh"
import SkipToContent from "@/components/SkipToContent"
import WhatsNewModal from "@/components/WhatsNewModal"

export const metadata: Metadata = {
  title: "FamilyChart",
  description: "Family medication and health tracker",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", type: "image/png" },
    ],
    apple: "/icons/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "FamilyChart",
    startupImage: "/icons/icon-512.png",
  },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#C8DDEF",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="FamilyChart" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className="flex h-[100dvh] flex-col overflow-hidden [&>*]:min-h-0">
        <SkipToContent />
        <AppLockProvider>{children}</AppLockProvider>
        <DeployRefresh />
        <WhatsNewModal />
      </body>
    </html>
  )
}
