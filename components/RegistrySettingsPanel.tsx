// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  getSettingUiMeta,
  IANA_TIMEZONES,
  SETTINGS_UI_SECTIONS,
  type SettingFieldType,
} from "@/lib/settings/ui-metadata"
import { SETTING_LOCALE_DEFAULT_TIMEZONE } from "@/lib/settings/registry"
import type { AdminResolvedSetting } from "@/lib/settings/resolver"

function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

function draftFromSetting(setting: AdminResolvedSetting): string {
  if (setting.locked) return setting.secret ? "" : setting.value
  if (setting.secret) return ""
  if (setting.key === SETTING_LOCALE_DEFAULT_TIMEZONE && setting.source === "default" && setting.value === "") {
    return browserTimezone()
  }
  return setting.value
}

function LockBadge() {
  return (
    <span className="text-xs bg-white/20 text-white rounded-full px-2 py-0.5">
      Managed via environment
    </span>
  )
}

function FieldInput({
  fieldType,
  value,
  onChange,
  disabled,
  meta,
}: {
  fieldType: SettingFieldType
  value: string
  onChange: (v: string) => void
  disabled: boolean
  meta: ReturnType<typeof getSettingUiMeta>
}) {
  const baseClass =
    "rounded-lg border border-white/30 bg-white/95 px-3 py-2 text-sm text-gray-900 disabled:opacity-70 disabled:cursor-not-allowed w-full"

  if (fieldType === "boolean") {
    return (
      <select
        value={value === "true" ? "true" : "false"}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className={baseClass}
      >
        <option value="false">No</option>
        <option value="true">Yes</option>
      </select>
    )
  }

  if (fieldType === "select") {
    return (
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className={baseClass}
      >
        {(meta.options ?? []).map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    )
  }

  if (fieldType === "secret") {
    return (
      <input
        type="password"
        autoComplete="new-password"
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className={baseClass}
        placeholder="Enter new value to replace"
      />
    )
  }

  if (fieldType === "timezone") {
    return (
      <>
        <input
          type="text"
          list={disabled ? undefined : "iana-tz-list"}
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className={baseClass}
          placeholder={meta.placeholder}
        />
        {!disabled && (
          <datalist id="iana-tz-list">
            {IANA_TIMEZONES.map(tz => (
              <option key={tz} value={tz} />
            ))}
          </datalist>
        )}
      </>
    )
  }

  const inputType = fieldType === "minutes" || fieldType === "port" ? "number" : "text"
  return (
    <input
      type={inputType}
      min={meta.min}
      max={meta.max}
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      className={baseClass}
      placeholder={meta.placeholder}
    />
  )
}

export default function RegistrySettingsPanel() {
  const [settings, setSettings] = useState<AdminResolvedSetting[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingSection, setSavingSection] = useState<string | null>(null)
  const [testingEmail, setTestingEmail] = useState(false)
  const [testEmailResult, setTestEmailResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [saveErr, setSaveErr] = useState("")
  const [saveErrSection, setSaveErrSection] = useState<string | null>(null)
  const [managedOutboundEmail, setManagedOutboundEmail] = useState<{
    configured: boolean
  } | null>(null)

  const settingsByKey = useMemo(() => {
    const map = new Map<string, AdminResolvedSetting>()
    for (const row of settings) map.set(row.key, row)
    return map
  }, [settings])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/app-settings")
      if (!res.ok) return
      const body = await res.json() as {
        settings: AdminResolvedSetting[]
        managedOutboundEmail: { configured: boolean } | null
      }
      const rows = body.settings ?? []
      setSettings(rows)
      setManagedOutboundEmail(body.managedOutboundEmail ?? null)
      const nextDrafts: Record<string, string> = {}
      for (const row of rows) nextDrafts[row.key] = draftFromSetting(row)
      setDrafts(nextDrafts)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function patchSetting(key: string, value: string): Promise<AdminResolvedSetting | null> {
    const res = await fetch("/api/app-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setSaveErr(typeof body.error === "string" ? body.error : "Could not save setting.")
      return null
    }
    return body as AdminResolvedSetting
  }

  async function handleSaveSection(sectionId: string, keys: string[]) {
    setSavingSection(sectionId)
    setSaveErr("")
    setSaveErrSection(null)
    try {
      const updated: AdminResolvedSetting[] = []
      for (const key of keys) {
        const setting = settingsByKey.get(key)
        if (!setting || setting.locked) continue
        const value = drafts[key] ?? ""
        if (setting.secret && setting.secretSet && value === "") continue
        const row = await patchSetting(key, value)
        if (!row) {
          setSaveErrSection(sectionId)
          return
        }
        updated.push(row)
      }
      if (updated.length === 0) return
      setSettings(prev => {
        const map = new Map(prev.map(r => [r.key, r]))
        for (const row of updated) map.set(row.key, row)
        return [...map.values()]
      })
      setDrafts(prev => {
        const next = { ...prev }
        for (const row of updated) next[row.key] = draftFromSetting(row)
        return next
      })
    } finally {
      setSavingSection(null)
    }
  }

  async function handleRemoveSecret(key: string) {
    setSaveErr("")
    setSaveErrSection(null)
    const row = await patchSetting(key, "")
    if (!row) {
      const owner = SETTINGS_UI_SECTIONS.find(s => s.keys.includes(key))
      setSaveErrSection(owner?.id ?? null)
      return
    }
    setSettings(prev => prev.map(r => (r.key === key ? row : r)))
    setDrafts(prev => ({ ...prev, [key]: "" }))
  }

  async function handleTestEmail() {
    setTestingEmail(true)
    setTestEmailResult(null)
    try {
      const res = await fetch("/api/app-settings/test-email", { method: "POST" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTestEmailResult({ ok: false, text: typeof body.error === "string" ? body.error : "Test email failed." })
        return
      }
      setTestEmailResult({
        ok: true,
        text: typeof body.to === "string" ? `Test email sent to ${body.to}.` : "Test email sent.",
      })
    } finally {
      setTestingEmail(false)
    }
  }

  const testEmailButton = (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleTestEmail}
        disabled={testingEmail}
        className="self-start px-4 py-2 rounded-xl border border-white/40 text-white font-semibold text-sm
                   hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {testingEmail ? "Sending…" : "Send test email"}
      </button>
      {testEmailResult && (
        <p className={testEmailResult.ok ? "text-white text-xs" : "text-red-200 text-xs"}>
          {testEmailResult.text}
        </p>
      )}
    </div>
  )

  return (
    <div className="max-w-lg mx-auto w-full flex flex-col gap-3">
      {SETTINGS_UI_SECTIONS.map(section => {
        const sectionKeys = section.keys.filter(k => settingsByKey.has(k))
        if (sectionKeys.length === 0) return null

        const allLocked = sectionKeys.every(k => settingsByKey.get(k)?.locked)
        const anyEditable = sectionKeys.some(k => !settingsByKey.get(k)?.locked)

        return (
          <div key={section.id} className="rounded-xl bg-fc-blue-mid p-4 flex flex-col gap-4 shadow-md">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-white font-bold text-base">{section.title}</h2>
                {allLocked && <LockBadge />}
              </div>
              {section.description && (
                <p className="text-white text-xs mt-1 leading-snug">{section.description}</p>
              )}
            </div>

            {loading ? (
              <p className="text-white text-sm">Loading…</p>
            ) : (
              <>
                <div className="flex flex-col gap-3">
                  {sectionKeys.map(key => {
                    const setting = settingsByKey.get(key)!
                    const meta = getSettingUiMeta(key)
                    const draft = drafts[key] ?? ""
                    const disabled = setting.locked || savingSection === section.id

                    return (
                      <div key={key} className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <label htmlFor={`setting-${key}`} className="text-white text-xs font-semibold">
                            {meta.label}
                          </label>
                          {setting.locked && !allLocked && <LockBadge />}
                        </div>
                        {meta.description && (
                          <p className="text-white text-xs leading-snug">{meta.description}</p>
                        )}
                        {setting.secret && setting.secretSet && !setting.locked && (
                          <p className="text-white text-xs">Value is set. Enter a new value to replace, or remove.</p>
                        )}
                        {setting.secret && setting.secretSet && setting.locked && (
                          <p className="text-white text-xs">Value is set (managed via environment).</p>
                        )}
                        <FieldInput
                          fieldType={meta.fieldType}
                          value={draft}
                          onChange={v => setDrafts(d => ({ ...d, [key]: v }))}
                          disabled={disabled}
                          meta={meta}
                        />
                        {setting.secret && setting.secretSet && !setting.locked && (
                          <button
                            type="button"
                            onClick={() => handleRemoveSecret(key)}
                            className="self-start text-xs text-white underline hover:text-white"
                          >
                            Remove secret
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>

                {saveErrSection === section.id && saveErr && (
                  <p className="text-red-200 text-sm">{saveErr}</p>
                )}

                {anyEditable && (
                  <button
                    type="button"
                    onClick={() => handleSaveSection(section.id, sectionKeys)}
                    disabled={savingSection === section.id}
                    className="self-start px-4 py-2 rounded-xl bg-white text-fc-blue font-semibold text-sm
                               hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {savingSection === section.id ? "Saving…" : `Save ${section.title.toLowerCase()}`}
                  </button>
                )}

                {section.id === "email-smtp" && testEmailButton}
              </>
            )}
          </div>
        )
      })}

      {managedOutboundEmail && (
        <div className="rounded-xl bg-fc-blue-mid p-4 flex flex-col gap-4 shadow-md">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-white font-bold text-base">Outbound email</h2>
              <LockBadge />
            </div>
            <p className="text-white text-xs mt-1 leading-snug">
              Platform-provisioned Microsoft Graph mail. SMTP settings are not editable on managed instances.
            </p>
          </div>
          {loading ? (
            <p className="text-white text-sm">Loading…</p>
          ) : (
            <>
              <p className="text-white text-sm">
                {managedOutboundEmail.configured
                  ? "Outbound email: configured via Microsoft Graph"
                  : "Outbound email: not configured"}
              </p>
              {testEmailButton}
            </>
          )}
        </div>
      )}
    </div>
  )
}
