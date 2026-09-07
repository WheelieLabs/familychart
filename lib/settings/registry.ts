// SPDX-License-Identifier: AGPL-3.0-only

import { isValidSmtpHost } from "@/lib/smtp-host"

export type SettingScope = "tenant"
export type SetupStage = "wizard" | "deferred"

export interface SettingDefinition {
  key: string
  envVar: string
  validate: (value: string) => boolean
  scope: SettingScope
  secret: boolean
  default: string
  /** Group env-lock: any set env var in the group locks the whole group. */
  group?: string
  /** Hidden under managed profile. */
  platformLocked?: boolean
  /** First-run wizard vs deferred. */
  setupStage?: SetupStage
}

export const SETTING_LOCALE_DEFAULT_TIMEZONE = "locale.default_timezone"
export const SETTING_LOCALE_MEASUREMENT_SYSTEM = "locale.measurement_system"
export const SETTING_SCHEDULE_LEAD_MINUTES = "schedule.lead_minutes"
export const SETTING_SCHEDULE_OVERDUE_OFFSET_MINUTES = "schedule.overdue_offset_minutes"
export const SETTING_SCHEDULE_SLOT_ASSOCIATION_RADIUS_MINUTES = "schedule.slot_association_radius_minutes"

export const SETTING_AUTH_ENTRA_ENABLED = "auth.entra.enabled"
export const SETTING_AUTH_ENTRA_CLIENT_ID = "auth.entra.client_id"
export const SETTING_AUTH_ENTRA_TENANT_ID = "auth.entra.tenant_id"
export const SETTING_AUTH_ENTRA_CLIENT_SECRET = "auth.entra.client_secret"

export const SETTING_SECURITY_MFA_REQUIRED = "security.mfa_required"
export const SETTING_SECURITY_PASSWORD_MIN_LENGTH = "security.password_min_length"

export const SETTING_EMAIL_SMTP_HOST = "email.smtp.host"
export const SETTING_EMAIL_SMTP_PORT = "email.smtp.port"
export const SETTING_EMAIL_SMTP_USER = "email.smtp.user"
export const SETTING_EMAIL_SMTP_PASSWORD = "email.smtp.password"
export const SETTING_EMAIL_SMTP_TLS = "email.smtp.tls"

export const SETTING_PUSH_VAPID_SUBJECT = "push.vapid_subject"
export const SETTING_PUSH_VAPID_PUBLIC_KEY = "push.vapid_public_key"
export const SETTING_PUSH_VAPID_PRIVATE_KEY = "push.vapid_private_key"

export const GROUP_AUTH_ENTRA = "auth.entra"
export const GROUP_EMAIL_SMTP = "email.smtp"

const SCHEDULE_LEAD_DEFAULT = "60"
const SCHEDULE_OVERDUE_OFFSET_DEFAULT = "30"
const SCHEDULE_SLOT_ASSOCIATION_RADIUS_DEFAULT = "60"
const MFA_REQUIRED_DEFAULT = "false"
const PASSWORD_MIN_LENGTH_DEFAULT = "10"
const SMTP_TLS_DEFAULT = "true"
const AUTH_ENTRA_ENABLED_DEFAULT = "false"
const SMTP_PORT_DEFAULT = "587"
const MEASUREMENT_SYSTEM_DEFAULT = "metric"

export type MeasurementSystem = "metric" | "imperial"

export function isValidMeasurementSystem(value: string): value is MeasurementSystem {
  return value === "metric" || value === "imperial"
}

export function scheduleSettingDefaults(): {
  leadMinutes: number
  overdueOffsetMinutes: number
  slotAssociationRadiusMinutes: number
} {
  return {
    leadMinutes: parseInt(SCHEDULE_LEAD_DEFAULT, 10),
    overdueOffsetMinutes: parseInt(SCHEDULE_OVERDUE_OFFSET_DEFAULT, 10),
    slotAssociationRadiusMinutes: parseInt(SCHEDULE_SLOT_ASSOCIATION_RADIUS_DEFAULT, 10),
  }
}

function isValidScheduleMinutes(value: string, min: number, max: number): boolean {
  if (value === "") return false
  const n = parseInt(value, 10)
  return Number.isFinite(n) && n >= min && n <= max
}

export function isValidScheduleLeadMinutes(value: string): boolean {
  return isValidScheduleMinutes(value, 5, 480)
}

export function isValidScheduleOverdueOffsetMinutes(value: string): boolean {
  return isValidScheduleMinutes(value, 30, 720)
}

export function isValidScheduleSlotAssociationRadiusMinutes(value: string): boolean {
  return isValidScheduleMinutes(value, 15, 480)
}

export function isValidBooleanSetting(value: string): boolean {
  return value === "true" || value === "false"
}

export function isValidPort(value: string): boolean {
  if (value === "") return false
  const n = parseInt(value, 10)
  return Number.isFinite(n) && n >= 1 && n <= 65535
}

export function isValidNonEmptyString(value: string): boolean {
  return value.trim() !== ""
}

export { isValidSmtpHost }

export function isValidOptionalString(value: string): boolean {
  return true
}

export function isValidPasswordMinLength(value: string): boolean {
  if (value === "") return false
  const n = parseInt(value, 10)
  return Number.isFinite(n) && n >= 8 && n <= 128
}

export function isValidVapidSubject(value: string): boolean {
  const v = value.trim()
  return v.startsWith("mailto:") || v.startsWith("https://")
}

export function isValidVapidPublicKey(value: string): boolean {
  return value.trim().length >= 20
}

/** Canonical IANA timezone list — shared by validation and the admin picker. */
export const IANA_TIMEZONES: readonly string[] = (() => {
  if (typeof Intl.supportedValuesOf === "function") {
    return Object.freeze([...Intl.supportedValuesOf("timeZone")].sort())
  }
  return Object.freeze([] as string[])
})()

export function isValidIanaTz(value: string): boolean {
  if (value === "") return true
  if (IANA_TIMEZONES.length > 0) return IANA_TIMEZONES.includes(value)
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value })
    return true
  } catch {
    return false
  }
}

export const APP_SETTINGS_REGISTRY: Record<string, SettingDefinition> = {
  [SETTING_LOCALE_DEFAULT_TIMEZONE]: {
    key: SETTING_LOCALE_DEFAULT_TIMEZONE,
    envVar: "FC_DEFAULT_TIMEZONE",
    validate: isValidIanaTz,
    scope: "tenant",
    secret: false,
    default: "",
    setupStage: "wizard",
  },
  [SETTING_LOCALE_MEASUREMENT_SYSTEM]: {
    key: SETTING_LOCALE_MEASUREMENT_SYSTEM,
    envVar: "FC_MEASUREMENT_SYSTEM",
    validate: isValidMeasurementSystem,
    scope: "tenant",
    secret: false,
    default: MEASUREMENT_SYSTEM_DEFAULT,
    setupStage: "deferred",
  },
  [SETTING_SCHEDULE_LEAD_MINUTES]: {
    key: SETTING_SCHEDULE_LEAD_MINUTES,
    envVar: "FC_SCHEDULE_LEAD_MINUTES",
    validate: isValidScheduleLeadMinutes,
    scope: "tenant",
    secret: false,
    default: SCHEDULE_LEAD_DEFAULT,
    setupStage: "deferred",
  },
  [SETTING_SCHEDULE_OVERDUE_OFFSET_MINUTES]: {
    key: SETTING_SCHEDULE_OVERDUE_OFFSET_MINUTES,
    envVar: "FC_SCHEDULE_OVERDUE_OFFSET_MINUTES",
    validate: isValidScheduleOverdueOffsetMinutes,
    scope: "tenant",
    secret: false,
    default: SCHEDULE_OVERDUE_OFFSET_DEFAULT,
    setupStage: "deferred",
  },
  [SETTING_SCHEDULE_SLOT_ASSOCIATION_RADIUS_MINUTES]: {
    key: SETTING_SCHEDULE_SLOT_ASSOCIATION_RADIUS_MINUTES,
    envVar: "FC_SCHEDULE_SLOT_ASSOCIATION_RADIUS_MINUTES",
    validate: isValidScheduleSlotAssociationRadiusMinutes,
    scope: "tenant",
    secret: false,
    default: SCHEDULE_SLOT_ASSOCIATION_RADIUS_DEFAULT,
    setupStage: "deferred",
  },
  [SETTING_AUTH_ENTRA_ENABLED]: {
    key: SETTING_AUTH_ENTRA_ENABLED,
    envVar: "FC_AUTH_ENTRA_ENABLED",
    validate: isValidBooleanSetting,
    scope: "tenant",
    secret: false,
    default: AUTH_ENTRA_ENABLED_DEFAULT,
    group: GROUP_AUTH_ENTRA,
    setupStage: "deferred",
  },
  [SETTING_AUTH_ENTRA_CLIENT_ID]: {
    key: SETTING_AUTH_ENTRA_CLIENT_ID,
    envVar: "AUTH_MICROSOFT_ENTRA_ID_ID",
    validate: isValidNonEmptyString,
    scope: "tenant",
    secret: false,
    default: "",
    group: GROUP_AUTH_ENTRA,
    setupStage: "deferred",
  },
  [SETTING_AUTH_ENTRA_TENANT_ID]: {
    key: SETTING_AUTH_ENTRA_TENANT_ID,
    envVar: "AUTH_MICROSOFT_ENTRA_ID_TENANT_ID",
    validate: isValidNonEmptyString,
    scope: "tenant",
    secret: false,
    default: "",
    group: GROUP_AUTH_ENTRA,
    setupStage: "deferred",
  },
  [SETTING_AUTH_ENTRA_CLIENT_SECRET]: {
    key: SETTING_AUTH_ENTRA_CLIENT_SECRET,
    envVar: "AUTH_MICROSOFT_ENTRA_ID_SECRET",
    validate: isValidNonEmptyString,
    scope: "tenant",
    secret: true,
    default: "",
    group: GROUP_AUTH_ENTRA,
    setupStage: "deferred",
  },
  [SETTING_SECURITY_MFA_REQUIRED]: {
    key: SETTING_SECURITY_MFA_REQUIRED,
    envVar: "FC_MFA_REQUIRED",
    validate: isValidBooleanSetting,
    scope: "tenant",
    secret: false,
    default: MFA_REQUIRED_DEFAULT,
    platformLocked: true,
    setupStage: "deferred",
  },
  [SETTING_SECURITY_PASSWORD_MIN_LENGTH]: {
    key: SETTING_SECURITY_PASSWORD_MIN_LENGTH,
    envVar: "FC_PASSWORD_MIN_LENGTH",
    validate: isValidPasswordMinLength,
    scope: "tenant",
    secret: false,
    default: PASSWORD_MIN_LENGTH_DEFAULT,
    platformLocked: true,
    setupStage: "deferred",
  },
  [SETTING_EMAIL_SMTP_HOST]: {
    key: SETTING_EMAIL_SMTP_HOST,
    envVar: "FC_SMTP_HOST",
    validate: isValidSmtpHost,
    scope: "tenant",
    secret: false,
    default: "",
    group: GROUP_EMAIL_SMTP,
    platformLocked: true,
    setupStage: "wizard",
  },
  [SETTING_EMAIL_SMTP_PORT]: {
    key: SETTING_EMAIL_SMTP_PORT,
    envVar: "FC_SMTP_PORT",
    validate: isValidPort,
    scope: "tenant",
    secret: false,
    default: SMTP_PORT_DEFAULT,
    group: GROUP_EMAIL_SMTP,
    platformLocked: true,
    setupStage: "wizard",
  },
  [SETTING_EMAIL_SMTP_USER]: {
    key: SETTING_EMAIL_SMTP_USER,
    envVar: "FC_SMTP_USER",
    validate: isValidOptionalString,
    scope: "tenant",
    secret: false,
    default: "",
    group: GROUP_EMAIL_SMTP,
    platformLocked: true,
    setupStage: "wizard",
  },
  [SETTING_EMAIL_SMTP_PASSWORD]: {
    key: SETTING_EMAIL_SMTP_PASSWORD,
    envVar: "FC_SMTP_PASSWORD",
    validate: isValidOptionalString,
    scope: "tenant",
    secret: true,
    default: "",
    group: GROUP_EMAIL_SMTP,
    platformLocked: true,
    setupStage: "wizard",
  },
  [SETTING_EMAIL_SMTP_TLS]: {
    key: SETTING_EMAIL_SMTP_TLS,
    envVar: "FC_SMTP_TLS",
    validate: isValidBooleanSetting,
    scope: "tenant",
    secret: false,
    default: SMTP_TLS_DEFAULT,
    group: GROUP_EMAIL_SMTP,
    platformLocked: true,
    setupStage: "wizard",
  },
  [SETTING_PUSH_VAPID_SUBJECT]: {
    key: SETTING_PUSH_VAPID_SUBJECT,
    envVar: "VAPID_SUBJECT",
    validate: isValidVapidSubject,
    scope: "tenant",
    secret: false,
    default: "",
    setupStage: "wizard",
  },
  [SETTING_PUSH_VAPID_PUBLIC_KEY]: {
    key: SETTING_PUSH_VAPID_PUBLIC_KEY,
    envVar: "VAPID_PUBLIC_KEY",
    validate: isValidVapidPublicKey,
    scope: "tenant",
    secret: false,
    default: "",
    setupStage: "deferred",
  },
  [SETTING_PUSH_VAPID_PRIVATE_KEY]: {
    key: SETTING_PUSH_VAPID_PRIVATE_KEY,
    envVar: "VAPID_PRIVATE_KEY",
    validate: isValidNonEmptyString,
    scope: "tenant",
    secret: true,
    default: "",
    setupStage: "deferred",
  },
}

export function getSettingDefinition(key: string): SettingDefinition | undefined {
  return APP_SETTINGS_REGISTRY[key]
}

export function settingsInGroup(group: string): SettingDefinition[] {
  return Object.values(APP_SETTINGS_REGISTRY).filter(e => e.group === group)
}

export function validateSettingValue(
  key: string,
  value: string,
): { ok: true } | { ok: false; error: string } {
  const entry = getSettingDefinition(key)
  if (!entry) return { ok: false, error: "Unknown setting" }
  if (!entry.validate(value)) {
    const label =
      key === SETTING_LOCALE_DEFAULT_TIMEZONE ? "Invalid timezone"
        : key === SETTING_LOCALE_MEASUREMENT_SYSTEM ? "Invalid measurement system"
          : key.startsWith("schedule.") ? "Invalid schedule timing"
            : key.startsWith("email.smtp.") ? "Invalid SMTP setting"
              : key.startsWith("push.vapid") ? "Invalid push setting"
                : key.startsWith("auth.entra.") ? "Invalid Entra setting"
                  : key.startsWith("security.") ? "Invalid security setting"
                    : "Invalid value"
    return { ok: false, error: label }
  }
  return { ok: true }
}

export function readRegistryEnvValue(entry: SettingDefinition): string | undefined {
  const raw = process.env[entry.envVar]
  if (raw == null) return undefined
  const trimmed = raw.trim()
  return trimmed === "" ? undefined : trimmed
}
