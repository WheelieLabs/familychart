// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import Link from "next/link"
import { Suspense, useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import AppHeader, { PersonHeader } from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import FormField from "@/components/FormField"
import PersonPhotoCapture from "@/components/PersonPhotoCapture"
import Toggle from "@/components/Toggle"
import { FcTabBar, type FcTabItem } from "@/components/FcTabBar"
import { formatHydration } from "@/lib/format"
import type { HydrationPacingConfig } from "@/lib/hydration/hydration-config"
import type { HydrationTzSource } from "@/lib/hydration/hydration-timezone"
import { IANA_TIMEZONES } from "@/lib/settings/registry"
import { mainContentTargetProps } from "@/lib/a11y"
import { useMfaEnrollment } from "@/lib/use-mfa-enrollment"

type ProfileTab = "profile" | "notifications" | "account" | "settings"

const PROFILE_TABS: readonly FcTabItem<ProfileTab>[] = [
  { value: "profile", label: "Profile" },
  { value: "notifications", label: "Notifications" },
  { value: "account", label: "Account" },
  { value: "settings", label: "Settings" },
]

const NOTIF_HISTORY_PAGE_SIZE = 20

const PROFILE_PHOTO_ASPECT = 1
const PROFILE_PHOTO_MAX_EDGE = 1024
const PROFILE_PHOTO_QUALITY = 0.8

interface NotificationHistoryRow {
  id: number
  person_id: number
  type: string
  title: string
  body: string
  sent_at: string
  person_name: string
  person_color: string
}

function parseNotificationSentAt(sentAt: string): number {
  const raw = sentAt.trim()
  if (!raw) return NaN
  if (raw.includes("T")) return Date.parse(raw)
  // SQLite CURRENT_TIMESTAMP is UTC without a zone suffix.
  return Date.parse(raw.replace(" ", "T") + "Z")
}

function formatRelativeNotificationTime(sentAt: string): string {
  const ms = parseNotificationSentAt(sentAt)
  if (!Number.isFinite(ms)) return sentAt
  const deltaSec = Math.round((Date.now() - ms) / 1000)
  if (deltaSec < 45) return "just now"
  if (deltaSec < 90) return "1 min ago"
  if (deltaSec < 3600) return `${Math.round(deltaSec / 60)} min ago`
  if (deltaSec < 5400) return "1 hour ago"
  if (deltaSec < 86400) return `${Math.round(deltaSec / 3600)} hours ago`
  if (deltaSec < 172800) return "yesterday"
  const days = Math.round(deltaSec / 86400)
  if (days < 30) return `${days} days ago`
  return new Date(ms).toLocaleDateString()
}

function isProfileTab(value: string | null): value is ProfileTab {
  return value === "profile" || value === "notifications" || value === "account" || value === "settings"
}

interface MeResponse {
  id: string
  name: string | null
  email: string | null
  image: string | null
  isLocal: boolean
  needsMfaEnrollment: boolean
  mfaEnrolled: boolean
  mfaPolicyRequired: boolean
  passwordMinLength: number
  hydrationGoalMl: number | null
  linkedPerson: {
    id: number
    name: string
    full_name: string | null
    photo_url: string | null
    color: string
  } | null
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0))) as Uint8Array<ArrayBuffer>
}

const inputClass =
  "w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-800"

const primaryBtnClass =
  "bg-fc-blue text-white font-bold px-6 py-3 rounded-xl " +
  "hover:bg-fc-blue-mid active:bg-fc-blue-dark disabled:opacity-50 transition-colors"

const primaryBtnEndClass = "self-end " + primaryBtnClass

const secondaryOutlineBtnClass =
  "flex-1 border border-gray-300 bg-white text-gray-800 font-bold py-3 rounded-xl " +
  "hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50 transition-colors"

export default function ProfilePage() {
  return (
    <Suspense fallback={<div className="flex flex-col flex-1 min-h-0 fc-surface-app" />}>
      <ProfilePageContent />
    </Suspense>
  )
}

function ProfilePageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get("tab")
  const tab: ProfileTab = isProfileTab(tabParam) ? tabParam : "profile"

  const [me, setMe] = useState<MeResponse | null>(null)
  const [loadErr, setLoadErr] = useState("")

  const [displayName, setDisplayName] = useState("")
  const [fullName, setFullName]     = useState("")
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [photoUrl, setPhotoUrl]     = useState<string | null>(null)
  const [uploading, setUploading]   = useState(false)
  const [savingPerson, setSavingPerson] = useState(false)
  const [personErr, setPersonErr]   = useState("")

  const [disPw, setDisPw]     = useState("")
  const [disOtp, setDisOtp]   = useState("")
  const [disBusy, setDisBusy] = useState(false)
  const [disErr, setDisErr]   = useState("")

  const [curPw, setCurPw]       = useState("")
  const [newPw, setNewPw]       = useState("")
  const [newPw2, setNewPw2]     = useState("")
  const [pwBusy, setPwBusy]     = useState(false)
  const [pwErr, setPwErr]       = useState("")
  const [pwOk, setPwOk]         = useState("")

  const [notifSupported, setNotifSupported] = useState(false)
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | null>(null)
  const [pushSub, setPushSub] = useState<PushSubscription | null>(null)
  const [subscribedPersonIds, setSubscribedPersonIds] = useState<number[]>([])
  const [notifPeople, setNotifPeople] = useState<{ id: number; name: string; color: string }[]>([])
  const [notifBusy, setNotifBusy] = useState(false)
  const [notifErr, setNotifErr] = useState("")
  const [testBusy, setTestBusy] = useState(false)
  const [testMsg, setTestMsg] = useState("")
  const [notifSubTab, setNotifSubTab] = useState<"preferences" | "history">("preferences")
  const [notifHistory, setNotifHistory] = useState<NotificationHistoryRow[]>([])
  const [notifHistoryCursor, setNotifHistoryCursor] = useState<{ ts: string; id: number } | null>(null)
  const [notifHistoryLoading, setNotifHistoryLoading] = useState(false)
  const [notifHistoryLoadingMore, setNotifHistoryLoadingMore] = useState(false)
  const [notifHistoryErr, setNotifHistoryErr] = useState("")
  const [notifHistoryLoaded, setNotifHistoryLoaded] = useState(false)

  const [hydrationConfig, setHydrationConfig] = useState<HydrationPacingConfig | null>(null)
  const [hydrationLoadErr, setHydrationLoadErr] = useState("")
  const [hydrationSaving, setHydrationSaving] = useState(false)
  const [hydrationSaveErr, setHydrationSaveErr] = useState("")
  const [hydrationSaveOk, setHydrationSaveOk] = useState("")
  const [activeStart, setActiveStart] = useState("07:00")
  const [activeEnd, setActiveEnd] = useState("21:00")
  const [glassSize, setGlassSize] = useState("250")

  const [userTimezone, setUserTimezone] = useState("")
  const [effectiveTimezone, setEffectiveTimezone] = useState<{
    tz: string | null
    source: HydrationTzSource
  } | null>(null)
  const [timezoneLoadErr, setTimezoneLoadErr] = useState("")
  const [timezoneSaving, setTimezoneSaving] = useState(false)
  const [timezoneSaveErr, setTimezoneSaveErr] = useState("")
  const [timezoneSaveOk, setTimezoneSaveOk] = useState("")

  const load = useCallback(async () => {
    setLoadErr("")
    const res = await fetch("/api/me", { cache: "no-store" })
    if (!res.ok) {
      setLoadErr("Could not load profile.")
      return
    }
    const data = (await res.json()) as MeResponse
    setMe(data)
    const lp = data.linkedPerson
    setDisplayName(lp?.name ?? data.name ?? "")
    setFullName(lp?.full_name ?? data.name ?? "")
    setPhotoUrl(lp?.photo_url ?? null)
    setPreviewUrl(lp?.photo_url ?? null)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const mfa = useMfaEnrollment({
    onConfirmed: async () => {
      router.refresh()
      await load()
    },
  })

  useEffect(() => {
    if (!me?.needsMfaEnrollment || !me.isLocal) return
    if (searchParams.get("tab")) return
    router.replace("/profile?tab=account")
  }, [me, searchParams, router])

  useEffect(() => {
    if (tab !== "settings" || me?.hydrationGoalMl == null) return
    let cancelled = false
    setHydrationLoadErr("")
    setTimezoneLoadErr("")
    Promise.all([
      fetch("/api/me/hydration-config", { cache: "no-store" }).then(r => {
        if (!r.ok) throw new Error("hydration load failed")
        return r.json() as Promise<HydrationPacingConfig>
      }),
      fetch("/api/me/timezone", { cache: "no-store" }).then(r => {
        if (!r.ok) throw new Error("timezone load failed")
        return r.json() as Promise<{
          timezone: string | null
          effective: { tz: string | null; source: HydrationTzSource }
        }>
      }),
    ])
      .then(([cfg, tz]) => {
        if (cancelled) return
        setHydrationConfig(cfg)
        setActiveStart(cfg.activeStart)
        setActiveEnd(cfg.activeEnd)
        setGlassSize(String(cfg.glassSize))
        setUserTimezone(tz.timezone ?? "")
        setEffectiveTimezone(tz.effective)
      })
      .catch(() => {
        if (!cancelled) {
          setHydrationLoadErr("Could not load hydration settings.")
          setTimezoneLoadErr("Could not load timezone.")
        }
      })
    return () => { cancelled = true }
  }, [tab, me?.hydrationGoalMl])

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return
    setNotifSupported(true)
    setNotifPermission(Notification.permission)

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations()
        .then(regs => {
          const swReg = regs.find(r => r.active?.scriptURL.includes("sw-push"))
          return swReg ? swReg.pushManager.getSubscription() : null
        })
        .then(sub => { if (sub) setPushSub(sub) })
        .catch(() => {})
    }

    fetch("/api/push/subscriptions")
      .then(r => r.ok ? r.json() : [])
      .then((rows: { person_id: number }[]) => setSubscribedPersonIds(rows.map(r => r.person_id)))
      .catch(() => {})

    fetch("/api/people")
      .then(r => r.ok ? r.json() : [])
      .then((rows: { id: number; name: string; color: string }[]) => setNotifPeople(rows))
      .catch(() => {})
  }, [])

  async function enableNotifications() {
    setNotifBusy(true)
    setNotifErr("")
    try {
      const permission = await Notification.requestPermission()
      setNotifPermission(permission)
      if (permission !== "granted") return

      const reg = await navigator.serviceWorker.register("/sw-push.js")
      await navigator.serviceWorker.ready

      const vapidRes = await fetch("/api/push/vapid-public-key")
      if (!vapidRes.ok) throw new Error("Push notifications are not configured on this server")
      const { vapidPublicKey } = await vapidRes.json() as { vapidPublicKey: string }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      })
      setPushSub(sub)

      const subJson = sub.toJSON()
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subJson.endpoint, p256dh: subJson.keys?.p256dh, auth: subJson.keys?.auth }),
      })

      const subsRes = await fetch("/api/push/subscriptions")
      if (subsRes.ok) {
        const rows = await subsRes.json() as { person_id: number }[]
        setSubscribedPersonIds(rows.map(r => r.person_id))
      }
    } catch (err) {
      setNotifErr(err instanceof Error ? err.message : "Failed to enable notifications")
    } finally {
      setNotifBusy(false)
    }
  }

  async function togglePerson(personId: number, on: boolean) {
    if (!pushSub) return
    setNotifErr("")
    const subJson = pushSub.toJSON()
    if (on) {
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subJson.endpoint, p256dh: subJson.keys?.p256dh, auth: subJson.keys?.auth, person_id: personId }),
      })
      if (res.ok) setSubscribedPersonIds(ids => [...ids.filter(id => id !== personId), personId])
      else setNotifErr("Failed to subscribe")
    } else {
      const res = await fetch("/api/push/unsubscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person_id: personId }),
      })
      if (res.ok) setSubscribedPersonIds(ids => ids.filter(id => id !== personId))
      else setNotifErr("Failed to unsubscribe")
    }
  }

  async function unregisterDevice() {
    if (!pushSub) return
    setNotifBusy(true)
    setNotifErr("")
    try {
      const subJson = pushSub.toJSON()
      await fetch("/api/push/unsubscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subJson.endpoint }),
      })
      await pushSub.unsubscribe()
      setPushSub(null)
      setSubscribedPersonIds([])
    } catch (err) {
      setNotifErr(err instanceof Error ? err.message : "Failed to unregister device")
    } finally {
      setNotifBusy(false)
    }
  }

  const loadNotifHistory = useCallback(async () => {
    setNotifHistoryLoading(true)
    setNotifHistoryErr("")
    try {
      const res = await fetch(
        `/api/me/notification-log?limit=${NOTIF_HISTORY_PAGE_SIZE}`,
      )
      const data = (await res.json().catch(() => ({}))) as {
        rows?: NotificationHistoryRow[]
        nextCursor?: { ts: string; id: number } | null
        error?: string
      }
      if (!res.ok) {
        setNotifHistoryErr(typeof data.error === "string" ? data.error : "Failed to load history")
        return
      }
      setNotifHistory(data.rows ?? [])
      setNotifHistoryCursor(data.nextCursor ?? null)
      setNotifHistoryLoaded(true)
    } catch {
      setNotifHistoryErr("Failed to load history")
    } finally {
      setNotifHistoryLoading(false)
    }
  }, [])

  const loadMoreNotifHistory = useCallback(async () => {
    if (!notifHistoryCursor || notifHistoryLoadingMore) return
    setNotifHistoryLoadingMore(true)
    setNotifHistoryErr("")
    try {
      const res = await fetch(
        `/api/me/notification-log?limit=${NOTIF_HISTORY_PAGE_SIZE}` +
          `&cursorTs=${encodeURIComponent(notifHistoryCursor.ts)}` +
          `&cursorId=${notifHistoryCursor.id}`,
      )
      const data = (await res.json().catch(() => ({}))) as {
        rows?: NotificationHistoryRow[]
        nextCursor?: { ts: string; id: number } | null
        error?: string
      }
      if (!res.ok) {
        setNotifHistoryErr(typeof data.error === "string" ? data.error : "Failed to load more")
        return
      }
      setNotifHistory(prev => [...prev, ...(data.rows ?? [])])
      setNotifHistoryCursor(data.nextCursor ?? null)
    } catch {
      setNotifHistoryErr("Failed to load more")
    } finally {
      setNotifHistoryLoadingMore(false)
    }
  }, [notifHistoryCursor, notifHistoryLoadingMore])

  useEffect(() => {
    if (tab !== "notifications" || notifSubTab !== "history" || notifHistoryLoaded) return
    void loadNotifHistory()
  }, [tab, notifSubTab, notifHistoryLoaded, loadNotifHistory])

  async function handlePhoto(blob: Blob) {
    setPreviewUrl(URL.createObjectURL(blob))
    setUploading(true)
    setPersonErr("")
    try {
      const fd = new FormData()
      fd.append("file", blob, "photo.jpg")
      if (me?.linkedPerson) fd.append("person_id", String(me.linkedPerson.id))
      const res = await fetch("/api/upload", { method: "POST", body: fd })
      if (!res.ok) throw new Error()
      const { url } = (await res.json()) as { url: string }
      setPhotoUrl(url)
    } catch {
      setPersonErr("Photo upload failed.")
      setPreviewUrl(photoUrl)
    } finally {
      setUploading(false)
    }
  }

  async function savePerson(e: React.FormEvent) {
    e.preventDefault()
    if (!me?.linkedPerson) return
    setSavingPerson(true)
    setPersonErr("")
    try {
      const res = await fetch("/api/me/person", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName.trim(),
          full_name: fullName.trim() === "" ? null : fullName.trim(),
          photo_url: photoUrl,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPersonErr(typeof j.error === "string" ? j.error : "Save failed.")
        return
      }
      router.refresh()
      await load()
    } finally {
      setSavingPerson(false)
    }
  }

  async function disableMfa(e: React.FormEvent) {
    e.preventDefault()
    setDisErr("")
    setDisBusy(true)
    try {
      const res = await fetch("/api/me/mfa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: disPw, otp: disOtp }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setDisErr(typeof j.error === "string" ? j.error : "Could not disable.")
        return
      }
      setDisPw("")
      setDisOtp("")
      router.refresh()
      await load()
    } finally {
      setDisBusy(false)
    }
  }

  async function changePw(e: React.FormEvent) {
    e.preventDefault()
    setPwErr("")
    setPwOk("")
    setPwBusy(true)
    try {
      const res = await fetch("/api/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: curPw,
          newPassword: newPw,
          confirmPassword: newPw2,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPwErr(typeof j.error === "string" ? j.error : "Could not update password.")
        return
      }
      setCurPw("")
      setNewPw("")
      setNewPw2("")
      setPwOk("Password updated.")
    } finally {
      setPwBusy(false)
    }
  }

  async function saveTimezone(e: React.FormEvent) {
    e.preventDefault()
    setTimezoneSaveErr("")
    setTimezoneSaveOk("")
    setTimezoneSaving(true)
    try {
      const trimmed = userTimezone.trim()
      const res = await fetch("/api/me/timezone", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: trimmed === "" ? null : trimmed }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTimezoneSaveErr(typeof j.error === "string" ? j.error : "Could not save timezone.")
        return
      }
      const data = j as {
        timezone: string | null
        effective: { tz: string | null; source: HydrationTzSource }
      }
      setUserTimezone(data.timezone ?? "")
      setEffectiveTimezone(data.effective)
      setTimezoneSaveOk("Timezone saved.")
    } finally {
      setTimezoneSaving(false)
    }
  }

  async function saveHydrationSettings(e: React.FormEvent) {
    e.preventDefault()
    setHydrationSaveErr("")
    setHydrationSaveOk("")
    setHydrationSaving(true)
    try {
      const glass = Number.parseInt(glassSize, 10)
      const res = await fetch("/api/me/hydration-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          active_start: activeStart,
          active_end: activeEnd,
          glass_size: glass,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setHydrationSaveErr(typeof j.error === "string" ? j.error : "Could not save settings.")
        return
      }
      const cfg = j as HydrationPacingConfig
      setHydrationConfig(cfg)
      setActiveStart(cfg.activeStart)
      setActiveEnd(cfg.activeEnd)
      setGlassSize(String(cfg.glassSize))
      setHydrationSaveOk("Hydration settings saved.")
    } finally {
      setHydrationSaving(false)
    }
  }

  if (!me && !loadErr) {
    return (
      <div className="flex flex-col flex-1">
        <AppHeader title="Profile" />
        <main {...mainContentTargetProps} className="flex-1 bg-fc-blue flex items-center justify-center">
          <div className="text-white text-lg">Loading…</div>
        </main>
        <AppFooter />
      </div>
    )
  }

  if (loadErr || !me) {
    return (
      <div className="flex flex-col flex-1">
        <AppHeader title="Profile" />
        <main {...mainContentTargetProps} className="flex-1 bg-fc-blue flex items-center justify-center p-4">
          <p className="text-white text-center">{loadErr}</p>
        </main>
        <AppFooter />
      </div>
    )
  }

  const linked = me.linkedPerson
  const headerName = (displayName.trim() || linked?.name || "Profile").trim()
  const headerPhoto = previewUrl ?? photoUrl ?? null
  const headerColor = linked?.color ?? "#256AA5"

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Profile" />
      {linked && (
        <PersonHeader
          name={headerName}
          photoUrl={headerPhoto}
          color={headerColor}
        />
      )}
      {me.needsMfaEnrollment && me.isLocal && (
        <div
          className="mx-3 mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3
                     text-gray-800 text-sm leading-relaxed shrink-0"
        >
          Complete authenticator setup below before you can use the rest of FamilyChart.
        </div>
      )}
      <FcTabBar tabs={PROFILE_TABS} active={tab} onSelect={t => router.push(`?tab=${t}`)} />
      <main {...mainContentTargetProps} className="flex-1 bg-fc-blue overflow-y-auto fc-scroll min-h-0">
        {tab === "profile" && (
          <div className="bg-fc-panel m-3 rounded-xl p-4 flex flex-col gap-4">
            <h2 className="font-bold text-gray-800 text-lg">Your family profile</h2>
            {!me.isLocal && (
              <p className="text-gray-600 text-sm leading-relaxed">
                Empty fields below can be filled to match how you want to appear in FamilyChart; your
                Microsoft name is a useful starting point.
              </p>
            )}
            {linked ? (
              <form onSubmit={savePerson} className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-4">
                  <div
                    className="w-24 h-24 rounded-full border-[3px] border-fc-ring overflow-hidden shrink-0
                                flex items-center justify-center"
                    style={{ backgroundColor: headerColor }}
                  >
                    {previewUrl || photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={previewUrl ?? photoUrl ?? ""} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-white font-bold text-2xl">
                        {(displayName || linked.name).slice(0, 2).toUpperCase() || "?"}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <PersonPhotoCapture
                      aspect={PROFILE_PHOTO_ASPECT}
                      maxEdge={PROFILE_PHOTO_MAX_EDGE}
                      quality={PROFILE_PHOTO_QUALITY}
                      uploading={uploading}
                      hasPhoto={!!(previewUrl || photoUrl)}
                      onPhoto={handlePhoto}
                    />
                  </div>
                </div>
                <div>
                  <label className="font-bold text-gray-800 block mb-1">Display name</label>
                  <input
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    required
                    placeholder={me.name ?? "Name on home screen"}
                    className={inputClass}
                  />
                  <p className="text-gray-600 text-xs mt-1">Shown on the home list and person header.</p>
                </div>
                <div>
                  <label className="font-bold text-gray-800 block mb-1">Full name</label>
                  <input
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    placeholder={me.name ?? "Legal or formal name"}
                    className={inputClass}
                  />
                  <p className="text-gray-600 text-xs mt-1">Used on reports when you need a full name.</p>
                </div>
                {personErr && <p className="text-red-600 text-sm">{personErr}</p>}
                <button type="submit" disabled={savingPerson} className={primaryBtnEndClass}>
                  {savingPerson ? "Saving…" : "Save"}
                </button>
              </form>
            ) : (
              <p className="text-gray-700 text-sm leading-relaxed">
                Your account is not linked to a family member yet. An administrator can link you under{" "}
                <strong>Management → People</strong> (choose your person and set “Linked account”).
              </p>
            )}
          </div>
        )}

        {tab === "notifications" && (
          <div className="bg-fc-panel m-3 rounded-xl p-4 flex flex-col gap-4">
            <h2 className="font-bold text-gray-800 text-lg">Push notifications</h2>

            <div
              className="flex rounded-lg overflow-hidden border border-fc-ring bg-fc-blue-mid/40 p-0.5"
              role="tablist"
              aria-label="Notification sections"
            >
              {([
                { value: "preferences" as const, label: "Preferences" },
                { value: "history" as const, label: "History" },
              ]).map(item => {
                const active = notifSubTab === item.value
                return (
                  <button
                    key={item.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setNotifSubTab(item.value)}
                    className={
                      "flex-1 px-3 py-2 text-sm font-semibold rounded-md transition-colors " +
                      (active
                        ? "bg-fc-blue text-white shadow-sm"
                        : "bg-transparent text-fc-blue/70 hover:text-fc-blue")
                    }
                  >
                    {item.label}
                  </button>
                )
              })}
            </div>

            {notifSubTab === "preferences" && (
              <>
                {!notifSupported && (
                  <p className="text-gray-600 text-sm">
                    Push notifications are not supported in this browser.
                  </p>
                )}

                {notifSupported && notifPermission === "denied" && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-gray-800">
                    Notifications are blocked in your browser settings. Enable them there to use this feature.
                  </div>
                )}

                {notifSupported && notifPermission !== "denied" && !pushSub && (
                  <>
                    <p className="text-gray-600 text-sm leading-relaxed">
                      Enable push notifications on this device to receive medication and observation reminders.
                    </p>
                    {notifErr && <p className="text-red-600 text-sm">{notifErr}</p>}
                    <button
                      type="button"
                      onClick={enableNotifications}
                      disabled={notifBusy}
                      className={primaryBtnClass + " self-start"}
                    >
                      {notifBusy ? "Enabling…" : "Enable notifications"}
                    </button>
                  </>
                )}

                {notifSupported && pushSub && (
                  <>
                    <p className="text-gray-600 text-sm">
                      Notifications are enabled on this device. Choose which people you want reminders for.
                    </p>
                    <div className="flex flex-col gap-2">
                      {notifPeople.map(person => {
                        const isOn = subscribedPersonIds.includes(person.id)
                        return (
                          <div key={person.id} className="flex items-center justify-between gap-3 py-1">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-6 h-6 rounded-full shrink-0"
                                style={{ backgroundColor: person.color }}
                              />
                              <span className="text-gray-800 text-sm font-medium">{person.name}</span>
                            </div>
                            <Toggle
                              value={isOn}
                              onChange={v => togglePerson(person.id, v)}
                              ariaLabel={`Notifications for ${person.name}`}
                            />
                          </div>
                        )
                      })}
                    </div>
                    {notifErr && <p className="text-red-600 text-sm">{notifErr}</p>}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          setTestBusy(true)
                          setTestMsg("")
                          try {
                            const res = await fetch("/api/push/test", { method: "POST" })
                            const j = await res.json().catch(() => ({}))
                            if (res.ok) {
                              setTestMsg("Test notification sent!")
                            } else {
                              setTestMsg(typeof j.error === "string" ? j.error : "Send failed")
                            }
                          } catch {
                            setTestMsg("Send failed")
                          } finally {
                            setTestBusy(false)
                          }
                        }}
                        disabled={testBusy}
                        className="border border-gray-300 bg-white text-gray-700 text-sm font-medium px-4 py-2 rounded-lg
                                   hover:bg-gray-50 disabled:opacity-50 transition-colors"
                      >
                        {testBusy ? "Sending…" : "Send test notification"}
                      </button>
                      <button
                        type="button"
                        onClick={unregisterDevice}
                        disabled={notifBusy}
                        className="border border-gray-300 bg-white text-gray-700 text-sm font-medium px-4 py-2 rounded-lg
                                   hover:bg-gray-50 disabled:opacity-50 transition-colors"
                      >
                        {notifBusy ? "Please wait…" : "Unregister this device"}
                      </button>
                    </div>
                    {testMsg && (
                      <p className={testMsg.startsWith("Test") ? "text-green-700 text-sm" : "text-red-600 text-sm"}>
                        {testMsg}
                      </p>
                    )}
                  </>
                )}
              </>
            )}

            {notifSubTab === "history" && (
              <div className="flex flex-col gap-3">
                <p className="text-gray-600 text-sm">
                  Notifications sent to your account, newest first.
                </p>
                {notifHistoryLoading && (
                  <p className="text-gray-500 text-sm">Loading…</p>
                )}
                {notifHistoryErr && (
                  <p className="text-red-600 text-sm">{notifHistoryErr}</p>
                )}
                {!notifHistoryLoading && notifHistory.length === 0 && !notifHistoryErr && (
                  <p className="text-gray-500 text-sm">No notifications yet.</p>
                )}
                {notifHistory.length > 0 && (
                  <div className="max-h-80 overflow-y-auto flex flex-col gap-2 pr-1">
                    {notifHistory.map(row => (
                      <div
                        key={row.id}
                        className="flex items-start gap-3 rounded-lg bg-white border border-gray-200 px-3 py-2"
                      >
                        <div
                          className="w-6 h-6 rounded-full shrink-0 mt-0.5"
                          style={{ backgroundColor: row.person_color }}
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-gray-800 text-sm font-medium truncate">
                              {row.person_name}
                            </span>
                            <span className="text-gray-400 text-xs shrink-0">
                              {formatRelativeNotificationTime(row.sent_at)}
                            </span>
                          </div>
                          <p className="text-gray-700 text-sm leading-snug">{row.title}</p>
                          {row.body && row.body !== row.title && (
                            <p className="text-gray-500 text-xs leading-snug mt-0.5">{row.body}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {notifHistoryCursor && (
                  <button
                    type="button"
                    onClick={() => void loadMoreNotifHistory()}
                    disabled={notifHistoryLoadingMore}
                    className="self-start border border-gray-300 bg-white text-gray-700 text-sm font-medium px-4 py-2 rounded-lg
                               hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    {notifHistoryLoadingMore ? "Loading…" : "Load more"}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {tab === "account" && (
          <>
            {me.isLocal && (
              <>
                <div className="bg-fc-panel m-3 rounded-xl p-4 flex flex-col gap-4">
                  <h2 className="font-bold text-gray-800 text-lg">Authenticator app</h2>
                  <p className="text-gray-600 text-sm leading-relaxed">
                    Add a second step when you sign in with email and password.
                  </p>
                  {me.mfaPolicyRequired && !me.mfaEnrolled && (
                    <p className="text-amber-700 text-sm font-medium">
                      MFA is required on this instance.
                    </p>
                  )}
                  {me.mfaEnrolled ? (
                    <>
                      <p className="text-green-700 text-sm font-medium">Authenticator is enabled.</p>
                      {me.mfaPolicyRequired ? (
                        <p className="text-gray-600 text-sm border-t border-gray-200 pt-4">
                          MFA is required on this instance, so authenticator cannot be disabled here.
                          An administrator can clear MFA for account recovery if needed.
                        </p>
                      ) : (
                      <form onSubmit={disableMfa} className="flex flex-col gap-3 border-t border-gray-200 pt-4">
                        <p className="text-gray-600 text-xs">
                          To turn it off, confirm your password and a current code.
                        </p>
                        <FormField label="Password">
                          <input
                            type="password"
                            value={disPw}
                            onChange={e => setDisPw(e.target.value)}
                            required
                            autoComplete="current-password"
                            className={inputClass}
                          />
                        </FormField>
                        <FormField label="Authenticator code">
                          <input
                            type="text"
                            inputMode="numeric"
                            value={disOtp}
                            onChange={e => setDisOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                            required
                            placeholder="6-digit code"
                            className={inputClass}
                          />
                        </FormField>
                        {disErr && <p className="text-red-600 text-sm">{disErr}</p>}
                        <button
                          type="submit"
                          disabled={disBusy}
                          className="bg-red-600 text-white font-bold py-3 rounded-xl hover:bg-red-700
                                     disabled:opacity-50 transition-colors"
                        >
                          Disable authenticator
                        </button>
                      </form>
                      )}
                    </>
                  ) : (
                    <>
                      {!mfa.otpauth ? (
                        <form onSubmit={mfa.start} className="flex flex-col gap-3">
                          <p className="text-gray-600 text-xs">
                            Confirm your password before generating a new authenticator secret.
                          </p>
                          <FormField label="Password">
                            <input
                              type="password"
                              value={mfa.password}
                              onChange={e => mfa.setPassword(e.target.value)}
                              required
                              autoComplete="current-password"
                              className={inputClass}
                            />
                          </FormField>
                          {mfa.error && <p className="text-red-600 text-sm">{mfa.error}</p>}
                          <button
                            type="submit"
                            disabled={mfa.busy}
                            className={primaryBtnClass + " self-start"}
                          >
                            {mfa.busy ? "Please wait…" : "Set up authenticator"}
                          </button>
                        </form>
                      ) : (
                        <form onSubmit={mfa.confirm} className="flex flex-col gap-4">
                          {mfa.qr && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={mfa.qr}
                              alt="QR code"
                              className="w-48 h-48 mx-auto bg-white rounded-lg p-2 border border-gray-200"
                            />
                          )}
                          <p className="text-gray-600 text-xs break-all">
                            Or open this link on your phone:{" "}
                            <a href={mfa.otpauth ?? "#"} className="text-fc-blue underline font-medium">
                              Add to authenticator
                            </a>
                          </p>
                          <FormField label="Authenticator code">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={mfa.code}
                              onChange={e => mfa.setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                              placeholder="6-digit code to confirm"
                              required
                              className={inputClass + " text-center tracking-widest"}
                            />
                          </FormField>
                          {mfa.error && <p className="text-red-600 text-sm">{mfa.error}</p>}
                          <div className="flex flex-col sm:flex-row gap-2">
                            <button
                              type="button"
                              onClick={mfa.cancel}
                              className={secondaryOutlineBtnClass}
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              disabled={mfa.busy}
                              className={"flex-1 " + primaryBtnClass}
                            >
                              {mfa.busy ? "…" : "Confirm"}
                            </button>
                          </div>
                        </form>
                      )}
                    </>
                  )}
                </div>

                <div className="bg-fc-panel m-3 rounded-xl p-4 flex flex-col gap-4">
                  <h2 className="font-bold text-gray-800 text-lg">Change password</h2>
                  <form onSubmit={changePw} className="flex flex-col gap-3">
                    <FormField label="Current password">
                      <input
                        type="password"
                        value={curPw}
                        onChange={e => setCurPw(e.target.value)}
                        required
                        autoComplete="current-password"
                        className={inputClass}
                      />
                    </FormField>
                    <FormField
                      label="New password"
                      hint={
                        newPw.length > 0 && newPw.length < me.passwordMinLength
                          ? `${me.passwordMinLength - newPw.length} more character${me.passwordMinLength - newPw.length === 1 ? "" : "s"} needed`
                          : `Min. ${me.passwordMinLength} characters`
                      }
                    >
                      <input
                        type="password"
                        value={newPw}
                        onChange={e => setNewPw(e.target.value)}
                        required
                        autoComplete="new-password"
                        minLength={me.passwordMinLength}
                        className={inputClass}
                      />
                    </FormField>
                    <FormField label="Confirm new password">
                      <input
                        type="password"
                        value={newPw2}
                        onChange={e => setNewPw2(e.target.value)}
                        required
                        autoComplete="new-password"
                        minLength={me.passwordMinLength}
                        className={inputClass}
                      />
                    </FormField>
                    {pwErr && <p className="text-red-600 text-sm">{pwErr}</p>}
                    {pwOk && <p className="text-green-700 text-sm">{pwOk}</p>}
                    <button type="submit" disabled={pwBusy} className={primaryBtnEndClass}>
                      {pwBusy ? "Saving…" : "Save"}
                    </button>
                  </form>
                </div>
              </>
            )}

            {!me.isLocal && (
              <div className="bg-fc-panel m-3 rounded-xl p-4 flex flex-col gap-2">
                <h2 className="font-bold text-gray-800 text-lg">Sign-in security</h2>
                <div className="rounded-lg border border-blue-200 bg-blue-50/90 px-3 py-3 text-sm text-gray-800 leading-relaxed">
                  Your organisation manages Microsoft sign-in and any extra security (such as their MFA).
                  Password and authenticator settings in FamilyChart apply only to local accounts.
                </div>
              </div>
            )}
          </>
        )}

        {tab === "settings" && me.hydrationGoalMl != null && linked && (
          <>
            <div className="bg-fc-panel m-3 rounded-xl p-4 flex flex-col gap-4">
              <h2 className="font-bold text-gray-800 text-lg">Your timezone</h2>
              <p className="text-gray-600 text-sm leading-relaxed">
                Hydration reminders use this clock for your active window and daily totals. Leave blank
                to use the household default.
              </p>
              {timezoneLoadErr && <p className="text-red-600 text-sm">{timezoneLoadErr}</p>}
              {!timezoneLoadErr && effectiveTimezone === null && (
                <p className="text-gray-600 text-sm">Loading…</p>
              )}
              {effectiveTimezone && (
                <form onSubmit={saveTimezone} className="flex flex-col gap-4">
                  <div>
                    <label className="font-bold text-gray-800 block mb-1">IANA timezone</label>
                    <input
                      type="text"
                      list="profile-iana-tz-list"
                      value={userTimezone}
                      onChange={e => setUserTimezone(e.target.value)}
                      placeholder="e.g. Australia/Sydney"
                      className={inputClass}
                    />
                    <datalist id="profile-iana-tz-list">
                      {IANA_TIMEZONES.map(tz => (
                        <option key={tz} value={tz} />
                      ))}
                    </datalist>
                    <p className="text-gray-600 text-xs mt-1">
                      {effectiveTimezone.source === "user"
                        ? `Reminders use your timezone (${effectiveTimezone.tz}).`
                        : effectiveTimezone.source === "instance"
                          ? `Using household default (${effectiveTimezone.tz}).`
                          : "No valid timezone — hydration reminders are paused until one is set."}
                    </p>
                  </div>
                  {timezoneSaveErr && <p className="text-red-600 text-sm">{timezoneSaveErr}</p>}
                  {timezoneSaveOk && <p className="text-green-700 text-sm">{timezoneSaveOk}</p>}
                  <button type="submit" disabled={timezoneSaving} className={primaryBtnEndClass}>
                    {timezoneSaving ? "Saving…" : "Save"}
                  </button>
                </form>
              )}
            </div>

            <div className="bg-fc-panel m-3 rounded-xl p-4 flex flex-col gap-4">
            <h2 className="font-bold text-gray-800 text-lg">Hydration pacing</h2>
            <p className="text-gray-600 text-sm leading-relaxed">
              Set your active hours and usual glass size for hydration reminders.
            </p>
            {hydrationLoadErr && <p className="text-red-600 text-sm">{hydrationLoadErr}</p>}
            {!hydrationLoadErr && hydrationConfig === null && (
              <p className="text-gray-600 text-sm">Loading…</p>
            )}
            {hydrationConfig && (
              <form onSubmit={saveHydrationSettings} className="flex flex-col gap-4">
                <div className="rounded-lg border border-gray-200 bg-white/60 px-3 py-3 text-sm text-gray-800">
                  <span className="font-medium">Daily target: </span>
                  {formatHydration(me.hydrationGoalMl)}
                  <span className="text-gray-600">
                    {" "}
                    —{" "}
                    <Link
                      href={`/${linked.id}/schedules-goals`}
                      className="text-fc-blue underline font-medium"
                    >
                      Edit in Schedules &amp; Goals
                    </Link>
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="font-bold text-gray-800 block mb-1">Active window start</label>
                    <input
                      type="time"
                      value={activeStart}
                      onChange={e => setActiveStart(e.target.value)}
                      required
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="font-bold text-gray-800 block mb-1">Active window end</label>
                    <input
                      type="time"
                      value={activeEnd}
                      onChange={e => setActiveEnd(e.target.value)}
                      required
                      className={inputClass}
                    />
                  </div>
                </div>
                <div>
                  <label className="font-bold text-gray-800 block mb-1">Usual glass size (mL)</label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={glassSize}
                    onChange={e => setGlassSize(e.target.value)}
                    required
                    className={inputClass + " max-w-xs"}
                  />
                </div>
                {hydrationSaveErr && <p className="text-red-600 text-sm">{hydrationSaveErr}</p>}
                {hydrationSaveOk && <p className="text-green-700 text-sm">{hydrationSaveOk}</p>}
                <button type="submit" disabled={hydrationSaving} className={primaryBtnEndClass}>
                  {hydrationSaving ? "Saving…" : "Save"}
                </button>
              </form>
            )}
          </div>
          </>
        )}

        {tab === "settings" && me.hydrationGoalMl == null && (
          <div className="bg-fc-panel m-3 rounded-xl p-4">
            <p className="text-gray-600 text-sm">No user settings currently available.</p>
          </div>
        )}
      </main>
      <AppFooter />
    </div>
  )
}
