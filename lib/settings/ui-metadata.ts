// SPDX-License-Identifier: AGPL-3.0-only

import {
  APP_SETTINGS_REGISTRY,
  GROUP_AUTH_ENTRA,
  GROUP_EMAIL_SMTP,
  IANA_TIMEZONES,
  SETTING_AUTH_ENTRA_CLIENT_ID,
  SETTING_AUTH_ENTRA_CLIENT_SECRET,
  SETTING_AUTH_ENTRA_ENABLED,
  SETTING_AUTH_ENTRA_TENANT_ID,
  SETTING_EMAIL_SMTP_HOST,
  SETTING_EMAIL_SMTP_PASSWORD,
  SETTING_EMAIL_SMTP_PORT,
  SETTING_EMAIL_SMTP_TLS,
  SETTING_EMAIL_SMTP_USER,
  SETTING_LOCALE_DEFAULT_TIMEZONE,
  SETTING_LOCALE_MEASUREMENT_SYSTEM,
  SETTING_PUSH_VAPID_PRIVATE_KEY,
  SETTING_PUSH_VAPID_PUBLIC_KEY,
  SETTING_PUSH_VAPID_SUBJECT,
  SETTING_SCHEDULE_LEAD_MINUTES,
  SETTING_SCHEDULE_OVERDUE_OFFSET_MINUTES,
  SETTING_SCHEDULE_SLOT_ASSOCIATION_RADIUS_MINUTES,
  SETTING_SECURITY_MFA_REQUIRED,
  SETTING_SECURITY_PASSWORD_MIN_LENGTH,
  type SettingDefinition,
} from "@/lib/settings/registry"

export type SettingFieldType =
  | "text"
  | "boolean"
  | "timezone"
  | "minutes"
  | "secret"
  | "port"
  | "select"

export interface SettingUiMeta {
  label: string
  description: string
  fieldType: SettingFieldType
  min?: number
  max?: number
  placeholder?: string
  options?: ReadonlyArray<{ value: string; label: string }>
}

export interface SettingsUiSection {
  id: string
  title: string
  description?: string
  keys: string[]
}

const UI_META: Record<string, SettingUiMeta> = {
  [SETTING_LOCALE_DEFAULT_TIMEZONE]: {
    label: "Default timezone",
    description: "Instance-wide IANA timezone for scheduled features.",
    fieldType: "timezone",
    placeholder: "e.g. Australia/Sydney",
  },
  [SETTING_LOCALE_MEASUREMENT_SYSTEM]: {
    label: "Measurement system",
    description: "Default units on the record-observation form (kg/°C vs lb/°F). Per-record override remains allowed.",
    fieldType: "select",
    options: [
      { value: "metric", label: "Metric" },
      { value: "imperial", label: "Imperial" },
    ],
  },
  [SETTING_SCHEDULE_LEAD_MINUTES]: {
    label: "Upcoming lead (minutes)",
    description: "Minutes before a slot to show amber upcoming alerts.",
    fieldType: "minutes",
    min: 5,
    max: 480,
  },
  [SETTING_SCHEDULE_OVERDUE_OFFSET_MINUTES]: {
    label: "Overdue push offset (minutes)",
    description: "Minutes after nominal slot time before the overdue push fires.",
    fieldType: "minutes",
    min: 30,
    max: 720,
  },
  [SETTING_SCHEDULE_SLOT_ASSOCIATION_RADIUS_MINUTES]: {
    label: "History association (minutes)",
    description: "Radius within which a recorded dose associates with a scheduled slot.",
    fieldType: "minutes",
    min: 15,
    max: 480,
  },
  [SETTING_AUTH_ENTRA_ENABLED]: {
    label: "Microsoft Entra enabled",
    description: "Enable Microsoft Entra ID sign-in for this instance.",
    fieldType: "boolean",
  },
  [SETTING_AUTH_ENTRA_CLIENT_ID]: {
    label: "Entra client ID",
    description: "Azure app registration client ID.",
    fieldType: "text",
  },
  [SETTING_AUTH_ENTRA_TENANT_ID]: {
    label: "Entra tenant ID",
    description: "Azure Entra ID tenant ID.",
    fieldType: "text",
  },
  [SETTING_AUTH_ENTRA_CLIENT_SECRET]: {
    label: "Entra client secret",
    description: "Azure app registration client secret.",
    fieldType: "secret",
  },
  [SETTING_SECURITY_MFA_REQUIRED]: {
    label: "Require MFA",
    description: "Require TOTP MFA for local credential users.",
    fieldType: "boolean",
  },
  [SETTING_SECURITY_PASSWORD_MIN_LENGTH]: {
    label: "Minimum password length",
    description: "Minimum length for local account passwords.",
    fieldType: "minutes",
    min: 8,
    max: 128,
  },
  [SETTING_EMAIL_SMTP_HOST]: {
    label: "SMTP host",
    description: "Outbound mail server hostname.",
    fieldType: "text",
  },
  [SETTING_EMAIL_SMTP_PORT]: {
    label: "SMTP port",
    description: "Outbound mail server port.",
    fieldType: "port",
  },
  [SETTING_EMAIL_SMTP_USER]: {
    label: "SMTP username",
    description: "Optional SMTP authentication username.",
    fieldType: "text",
  },
  [SETTING_EMAIL_SMTP_PASSWORD]: {
    label: "SMTP password",
    description: "SMTP authentication password.",
    fieldType: "secret",
  },
  [SETTING_EMAIL_SMTP_TLS]: {
    label: "SMTP TLS",
    description: "Use TLS for SMTP connections.",
    fieldType: "boolean",
  },
  [SETTING_PUSH_VAPID_SUBJECT]: {
    label: "VAPID subject",
    description: "mailto: or https: URI for Web Push.",
    fieldType: "text",
    placeholder: "mailto:admin@example.com",
  },
  [SETTING_PUSH_VAPID_PUBLIC_KEY]: {
    label: "VAPID public key",
    description: "Web Push public key (auto-generated on first boot when unset).",
    fieldType: "text",
  },
  [SETTING_PUSH_VAPID_PRIVATE_KEY]: {
    label: "VAPID private key",
    description: "Web Push private key.",
    fieldType: "secret",
  },
}

export const SETTINGS_UI_SECTIONS: SettingsUiSection[] = [
  {
    id: "locale",
    title: "Locale",
    keys: [SETTING_LOCALE_DEFAULT_TIMEZONE, SETTING_LOCALE_MEASUREMENT_SYSTEM],
  },
  {
    id: "schedule",
    title: "Medication schedule windows",
    description: "Push delivery width is fixed at 30 minutes.",
    keys: [
      SETTING_SCHEDULE_LEAD_MINUTES,
      SETTING_SCHEDULE_OVERDUE_OFFSET_MINUTES,
      SETTING_SCHEDULE_SLOT_ASSOCIATION_RADIUS_MINUTES,
    ],
  },
  {
    id: "auth-entra",
    title: "Microsoft Entra",
    description: "Local credentials remain always available.",
    keys: [
      SETTING_AUTH_ENTRA_ENABLED,
      SETTING_AUTH_ENTRA_CLIENT_ID,
      SETTING_AUTH_ENTRA_TENANT_ID,
      SETTING_AUTH_ENTRA_CLIENT_SECRET,
    ],
  },
  {
    id: "security",
    title: "Security policy",
    keys: [SETTING_SECURITY_MFA_REQUIRED, SETTING_SECURITY_PASSWORD_MIN_LENGTH],
  },
  {
    id: "email-smtp",
    title: "Outbound email (SMTP)",
    keys: [
      SETTING_EMAIL_SMTP_HOST,
      SETTING_EMAIL_SMTP_PORT,
      SETTING_EMAIL_SMTP_USER,
      SETTING_EMAIL_SMTP_PASSWORD,
      SETTING_EMAIL_SMTP_TLS,
    ],
  },
  {
    id: "push",
    title: "Push notifications (VAPID)",
    keys: [
      SETTING_PUSH_VAPID_SUBJECT,
      SETTING_PUSH_VAPID_PUBLIC_KEY,
      SETTING_PUSH_VAPID_PRIVATE_KEY,
    ],
  },
]

export function getSettingUiMeta(key: string): SettingUiMeta {
  const existing = UI_META[key]
  if (existing) return existing
  const entry = APP_SETTINGS_REGISTRY[key]
  return {
    label: key,
    description: "",
    fieldType: entry?.secret ? "secret" : "text",
  }
}

export function inferFieldType(entry: SettingDefinition): SettingFieldType {
  const meta = UI_META[entry.key]
  if (meta) return meta.fieldType
  if (entry.secret) return "secret"
  if (entry.key.endsWith(".enabled") || entry.key.endsWith(".tls")) return "boolean"
  if (entry.key.endsWith(".port")) return "port"
  return "text"
}

export { IANA_TIMEZONES, GROUP_AUTH_ENTRA, GROUP_EMAIL_SMTP }
