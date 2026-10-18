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
import { getDeviceTimeZone } from "@/lib/date-format"
import Badge from "@/components/ui/Badge"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import { Input, Select } from "@/components/ui/controls"
import FormField from "@/components/ui/FormField"
import Panel from "@/components/ui/Panel"

function draftFromSetting(setting: AdminResolvedSetting): string {
  if (setting.locked) return setting.secret ? "" : setting.value
  if (setting.secret) return ""
  if (setting.key === SETTING_LOCALE_DEFAULT_TIMEZONE && setting.source === "default" && setting.value === "") {
    return getDeviceTimeZone()
  }
  return setting.value
}

function LockBadge() {
  return <Badge tone="info">Managed via environment</Badge>
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
  if (fieldType === "boolean") {
    return (
      <Select value={value === "true" ? "true" : "false"} onChange={e => onChange(e.target.value)} disabled={disabled}>
        <option value="false">No</option>
        <option value="true">Yes</option>
      </Select>
    )
  }

  if (fieldType === "select") {
    return (
      <Select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}>
        {(meta.options ?? []).map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </Select>
    )
  }

  if (fieldType === "secret") {
    return (
      <Input
        type="password"
        autoComplete="new-password"
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        placeholder="Enter new value to replace"
      />
    )
  }

  if (fieldType === "timezone") {
    return (
      <>
        <Input
          type="text"
          list={disabled ? undefined : "iana-tz-list"}
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
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
    <Input
      type={inputType}
      min={meta.min}
      max={meta.max}
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
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
    <div className="fc-form">
      <div className="fc-form-actions">
        <Button variant="secondary" size="compact" onClick={handleTestEmail} pending={testingEmail} pendingLabel="Sending…">
          Send test email
        </Button>
      </div>
      {testEmailResult && (
        <Banner kind={testEmailResult.ok ? "success" : "error"} announced>{testEmailResult.text}</Banner>
      )}
    </div>
  )

  return (
    <>
      {SETTINGS_UI_SECTIONS.map(section => {
        const sectionKeys = section.keys.filter(k => settingsByKey.has(k))
        if (sectionKeys.length === 0) return null

        const allLocked = sectionKeys.every(k => settingsByKey.get(k)?.locked)
        const anyEditable = sectionKeys.some(k => !settingsByKey.get(k)?.locked)

        return (
          <Panel key={section.id} as="section" aria-labelledby={`section-${section.id}`}>
            <div>
              <h2 id={`section-${section.id}`} className="fc-section-title">
                {section.title} {allLocked && <LockBadge />}
              </h2>
              {section.description && <p className="fc-section-copy">{section.description}</p>}
            </div>

            {loading ? (
              <p className="fc-section-copy">Loading…</p>
            ) : (
              <>
                {sectionKeys.map(key => {
                  const setting = settingsByKey.get(key)!
                  const meta = getSettingUiMeta(key)
                  const draft = drafts[key] ?? ""
                  const disabled = setting.locked || savingSection === section.id
                  const hint = [
                    meta.description,
                    setting.locked && !allLocked ? "Managed via environment." : "",
                    setting.secret && setting.secretSet && !setting.locked
                      ? "Value is set. Enter a new value to replace, or remove."
                      : "",
                    setting.secret && setting.secretSet && setting.locked ? "Value is set (managed via environment)." : "",
                  ].filter(Boolean).join(" ")

                  return (
                    <div key={key} className="fc-form">
                      <FormField label={meta.label} hint={hint || undefined} id={`setting-${key}`}>
                        <FieldInput
                          fieldType={meta.fieldType}
                          value={draft}
                          onChange={v => setDrafts(d => ({ ...d, [key]: v }))}
                          disabled={disabled}
                          meta={meta}
                        />
                      </FormField>
                      {setting.secret && setting.secretSet && !setting.locked && (
                        <div className="fc-form-actions">
                          <Button variant="destructive" size="compact" onClick={() => handleRemoveSecret(key)} aria-label={`Remove secret: ${meta.label}`}>
                            Remove secret
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })}

                {saveErrSection === section.id && saveErr && <Banner kind="error">{saveErr}</Banner>}

                {anyEditable && (
                  <div className="fc-form-actions">
                    <Button
                      size="compact"
                      onClick={() => handleSaveSection(section.id, sectionKeys)}
                      pending={savingSection === section.id}
                    >
                      {`Save ${section.title.toLowerCase()}`}
                    </Button>
                  </div>
                )}

                {section.id === "email-smtp" && testEmailButton}
              </>
            )}
          </Panel>
        )
      })}

      {managedOutboundEmail && (
        <Panel as="section" aria-labelledby="section-outbound-email">
          <div>
            <h2 id="section-outbound-email" className="fc-section-title">
              Outbound email <LockBadge />
            </h2>
            <p className="fc-section-copy">
              Platform-provisioned Microsoft Graph mail. SMTP settings are not editable on managed instances.
            </p>
          </div>
          {loading ? (
            <p className="fc-section-copy">Loading…</p>
          ) : (
            <>
              <p className="fc-section-copy">
                {managedOutboundEmail.configured
                  ? "Outbound email: configured via Microsoft Graph"
                  : "Outbound email: not configured"}
              </p>
              {testEmailButton}
            </>
          )}
        </Panel>
      )}
    </>
  )
}
