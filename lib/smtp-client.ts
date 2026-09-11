// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import {
  SETTING_EMAIL_SMTP_HOST,
  SETTING_EMAIL_SMTP_PASSWORD,
  SETTING_EMAIL_SMTP_PORT,
  SETTING_EMAIL_SMTP_TLS,
  SETTING_EMAIL_SMTP_USER,
} from "@/lib/settings/registry"
import { resolveSetting } from "@/lib/settings/resolver"

export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
}

function smtpRegistryComplete(db: Database.Database): boolean {
  const host = resolveSetting(db, SETTING_EMAIL_SMTP_HOST).value.trim()
  const port = resolveSetting(db, SETTING_EMAIL_SMTP_PORT).value.trim()
  const tls = resolveSetting(db, SETTING_EMAIL_SMTP_TLS).value.trim()
  if (host === "" || port === "" || tls !== "true" && tls !== "false") return false

  const portNum = parseInt(port, 10)
  if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) return false

  const password = resolveSetting(db, SETTING_EMAIL_SMTP_PASSWORD).value.trim()
  const passwordSet =
    password !== "" ||
    resolveSetting(db, SETTING_EMAIL_SMTP_PASSWORD).source === "env"

  return passwordSet
}

export function loadSmtpConfig(db: Database.Database): SmtpConfig | null {
  if (!smtpRegistryComplete(db)) return null
  const host = resolveSetting(db, SETTING_EMAIL_SMTP_HOST).value.trim()
  const port = parseInt(resolveSetting(db, SETTING_EMAIL_SMTP_PORT).value, 10)
  const secure = resolveSetting(db, SETTING_EMAIL_SMTP_TLS).value === "true"
  const user = resolveSetting(db, SETTING_EMAIL_SMTP_USER).value.trim()
  const password = resolveSetting(db, SETTING_EMAIL_SMTP_PASSWORD).value
  return { host, port, secure, user, password }
}
