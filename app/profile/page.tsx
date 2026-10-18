// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import AuthenticatorEnrolment from "@/components/AuthenticatorEnrolment"
import Link from "next/link"
import { Suspense, useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { signIn } from "next-auth/react"
import AppHeader, { PersonHeader } from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import EraseMyRecords from "@/components/EraseMyRecords"
import RemoveMyAccount from "@/components/RemoveMyAccount"
import ExportMyData from "@/components/ExportMyData"
import PersonPhotoCapture from "@/components/PersonPhotoCapture"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import { ChipGroup } from "@/components/ui/Chip"
import { Input, Select, Toggle } from "@/components/ui/controls"
import EmptyState, { EMPTY_STATE_ICONS } from "@/components/ui/EmptyState"
import { FcTabBar, type FcTabItem } from "@/components/ui/FcTabBar"
import FormField from "@/components/ui/FormField"
import PageContainer from "@/components/ui/PageContainer"
import Panel from "@/components/ui/Panel"
import { PasswordField } from "@/components/AuthShell"
import { formatDate } from "@/lib/date-format"
import {
  type AppLockGracePeriod,
  getAppLockGracePeriod,
  isAppLockDisabled,
  isBioLockEligible,
  setAppLockDisabled,
  setAppLockGracePeriod,
} from "@/lib/bio-lock-state"
import { formatHydration } from "@/lib/format"
import type { HydrationPacingConfig } from "@/lib/hydration/hydration-config"
import type { HydrationTzSource } from "@/lib/hydration/hydration-timezone"
import { IANA_TIMEZONES } from "@/lib/settings/registry"
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
  return formatDate(ms)
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

  const [deviceLockEligible, setDeviceLockEligible] = useState(false)
  const [appLockDisabledOnDevice, setAppLockDisabledOnDevice] = useState(false)
  const [gracePeriod, setGracePeriod] = useState<AppLockGracePeriod>("immediate")
  const [graceSaveOk, setGraceSaveOk] = useState("")
  const [showAppLockReauth, setShowAppLockReauth] = useState(false)
  const [reauthPassword, setReauthPassword] = useState("")
  const [reauthOtp, setReauthOtp] = useState("")
  const [reauthErr, setReauthErr] = useState("")
  const [reauthBusy, setReauthBusy] = useState(false)
  useEffect(() => {
    setDeviceLockEligible(isBioLockEligible())
  }, [])
  useEffect(() => {
    if (!me?.id) return
    setAppLockDisabledOnDevice(isAppLockDisabled(localStorage, me.id))
    setGracePeriod(getAppLockGracePeriod(localStorage, me.id))
  }, [me])

  const requestAppLockReauthGrant = useCallback(async (): Promise<boolean> => {
    setReauthBusy(true)
    setReauthErr("")
    try {
      const res = await fetch("/api/me/app-lock/reauth-grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(me?.isLocal ? { password: reauthPassword, otp: reauthOtp } : {}),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setReauthErr(typeof j.error === "string" ? j.error : "Could not confirm it's you.")
        return false
      }
      return true
    } finally {
      setReauthBusy(false)
    }
  }, [me, reauthPassword, reauthOtp])

  // Turning App lock off needs a fresh sign-in check (ADR-0016), so someone who
  // picks up this device while it's unlocked can't disable it. Re-enabling needs nothing extra.
  const onToggleAppLockDisabled = useCallback((next: boolean) => {
    if (!me?.id) return
    if (!next) {
      setAppLockDisabled(localStorage, me.id, false)
      setAppLockDisabledOnDevice(false)
      return
    }
    setReauthErr("")
    setShowAppLockReauth(true)
  }, [me])

  const confirmDisableAppLock = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!me?.id) return
    const granted = await requestAppLockReauthGrant()
    if (!granted) return
    setAppLockDisabled(localStorage, me.id, true)
    setAppLockDisabledOnDevice(true)
    setShowAppLockReauth(false)
    setReauthPassword("")
    setReauthOtp("")
  }, [me, requestAppLockReauthGrant])

  const confirmWithMicrosoft = useCallback(() => {
    void signIn(
      "microsoft-entra-id",
      { callbackUrl: "/profile?tab=account&confirmAppLockOff=1" },
      { prompt: "login", max_age: "0" },
    )
  }, [])

  // Lands back here after confirmWithMicrosoft's forced-fresh-login redirect completes —
  // the session now carries a fresh Entra auth_time, so finish the disable automatically.
  useEffect(() => {
    if (searchParams.get("confirmAppLockOff") !== "1" || !me?.id) return
    router.replace("/profile?tab=account")
    void (async () => {
      const granted = await requestAppLockReauthGrant()
      if (!granted) {
        setShowAppLockReauth(true)
        return
      }
      setAppLockDisabled(localStorage, me.id, true)
      setAppLockDisabledOnDevice(true)
      setShowAppLockReauth(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finish App lock disable after Microsoft re-auth return
  }, [searchParams, me?.id])

  const saveGracePeriod = useCallback((period: AppLockGracePeriod) => {
    if (!me?.id) return
    setAppLockGracePeriod(localStorage, me.id, period)
    setGracePeriod(period)
    setGraceSaveOk("App lock settings saved.")
    window.setTimeout(() => setGraceSaveOk(""), 3000)
  }, [me])

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
        <PageContainer>
          <p className="fc-admin-note">Loading…</p>
        </PageContainer>
        <AppFooter />
      </div>
    )
  }

  if (loadErr || !me) {
    return (
      <div className="flex flex-col flex-1">
        <AppHeader title="Profile" />
        <PageContainer>
          <EmptyState icon={EMPTY_STATE_ICONS.error} heading="Could not load your profile">
            {loadErr || "Try again in a moment."}
          </EmptyState>
        </PageContainer>
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
      <PageContainer tabs={<FcTabBar tabs={PROFILE_TABS} active={tab} onSelect={t => router.push(`?tab=${t}`)} />}>
        {linked && (
          <PersonHeader
            name={headerName}
            photoUrl={headerPhoto}
            color={headerColor}
          />
        )}
        {me.needsMfaEnrollment && me.isLocal && (
          <Banner kind="warning">Complete authenticator setup below before you can use the rest of FamilyChart.</Banner>
        )}

        {tab === "profile" && (
          <Panel>
            <h2 className="fc-section-title">Your family profile</h2>
            {!me.isLocal && (
              <p className="fc-section-copy">
                Empty fields below can be filled to match how you want to appear in FamilyChart; your
                Microsoft name is a useful starting point.
              </p>
            )}
            {linked ? (
              <form onSubmit={savePerson} className="fc-form">
                <div className="fc-photo-row">
                  <div className="fc-photo-row__avatar fc-photo-row__avatar--large" style={{ backgroundColor: headerColor }}>
                    {previewUrl || photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={previewUrl ?? photoUrl ?? ""} alt="" />
                    ) : (
                      <span aria-hidden="true">{(displayName || linked.name).slice(0, 2).toUpperCase() || "?"}</span>
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
                <FormField label="Display name" hint="Shown on the home list and person header.">
                  <Input
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    required
                    placeholder={me.name ?? "Name on home screen"}
                  />
                </FormField>
                <FormField label="Full name" optional hint="Used on reports when you need a full name.">
                  <Input
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    placeholder={me.name ?? "Legal or formal name"}
                  />
                </FormField>
                {personErr && <Banner kind="error">{personErr}</Banner>}
                <div className="fc-actions-end">
                  <Button type="submit" pending={savingPerson}>Save</Button>
                </div>
              </form>
            ) : (
              <p className="fc-section-copy">
                Your account is not linked to an active family member. Ask an administrator to link you
                (or reactivate your person).
              </p>
            )}
          </Panel>
        )}

        {tab === "notifications" && (
          <Panel>
            <h2 className="fc-section-title">Push notifications</h2>

            <ChipGroup
              legend="Notification sections"
              value={notifSubTab}
              onChange={setNotifSubTab}
              options={[
                { value: "preferences" as const, label: "Preferences" },
                { value: "history" as const, label: "History" },
              ]}
            />

            {notifSubTab === "preferences" && (
              <>
                {!notifSupported && (
                  <p className="fc-section-copy">Push notifications are not supported in this browser.</p>
                )}

                {notifSupported && notifPermission === "denied" && (
                  <Banner kind="warning">
                    Notifications are blocked in your browser settings. Enable them there to use this feature.
                  </Banner>
                )}

                {notifSupported && notifPermission !== "denied" && !pushSub && (
                  <>
                    <p className="fc-section-copy">
                      Enable push notifications on this device to receive medication and observation reminders.
                    </p>
                    {notifErr && <Banner kind="error">{notifErr}</Banner>}
                    <div>
                      <Button onClick={enableNotifications} pending={notifBusy} pendingLabel="Enabling…">Enable notifications</Button>
                    </div>
                  </>
                )}

                {notifSupported && pushSub && (
                  <>
                    <p className="fc-section-copy">
                      Notifications are enabled on this device. Choose which people you want reminders for.
                    </p>
                    <div className="fc-form" style={{ gap: 4 }}>
                      {notifPeople.map(person => (
                        <Toggle
                          key={person.id}
                          label={`Notifications for ${person.name}`}
                          checked={subscribedPersonIds.includes(person.id)}
                          onChange={v => void togglePerson(person.id, v)}
                        />
                      ))}
                    </div>
                    {notifErr && <Banner kind="error">{notifErr}</Banner>}
                    <div className="fc-form-actions">
                      <Button
                        variant="secondary"
                        pending={testBusy}
                        pendingLabel="Sending…"
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
                      >
                        Send test notification
                      </Button>
                      <Button variant="secondary" onClick={unregisterDevice} pending={notifBusy} pendingLabel="Please wait…">
                        Unregister this device
                      </Button>
                    </div>
                    {testMsg && (
                      <Banner kind={testMsg.startsWith("Test") ? "success" : "error"} announced>{testMsg}</Banner>
                    )}
                  </>
                )}
              </>
            )}

            {notifSubTab === "history" && (
              <div className="fc-form">
                <p className="fc-section-copy">Notifications sent to your account, newest first.</p>
                {notifHistoryLoading && <p className="fc-field__hint">Loading…</p>}
                {notifHistoryErr && <Banner kind="error">{notifHistoryErr}</Banner>}
                {!notifHistoryLoading && notifHistory.length === 0 && !notifHistoryErr && (
                  <p className="fc-field__hint">No notifications yet.</p>
                )}
                {notifHistory.length > 0 && (
                  <ul className="fc-notif-list">
                    {notifHistory.map(row => (
                      <li key={row.id} className="fc-notif">
                        <span className="fc-notif__dot" style={{ backgroundColor: row.person_color }} aria-hidden="true" />
                        <div className="fc-notif__body">
                          <div className="fc-notif__head">
                            <span className="fc-notif__who">{row.person_name}</span>
                            <span className="fc-field__hint">{formatRelativeNotificationTime(row.sent_at)}</span>
                          </div>
                          <p className="fc-notif__title">{row.title}</p>
                          {row.body && row.body !== row.title && (
                            <p className="fc-field__hint">{row.body}</p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {notifHistoryCursor && (
                  <div>
                    <Button variant="secondary" onClick={() => void loadMoreNotifHistory()} pending={notifHistoryLoadingMore} pendingLabel="Loading…">
                      Load more
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Panel>
        )}

        {tab === "account" && (
          <>
            {linked && <ExportMyData personId={linked.id} />}
            {linked && (
              <EraseMyRecords personId={linked.id} isLocal={me.isLocal} mfaEnrolled={me.mfaEnrolled} />
            )}
            {me.isLocal && (
              <>
                <Panel>
                  <h2 className="fc-section-title">Authenticator app</h2>
                  <p className="fc-section-copy">Add a second step when you sign in with email and password.</p>
                  {me.mfaPolicyRequired && !me.mfaEnrolled && (
                    <Banner kind="warning">MFA is required on this instance.</Banner>
                  )}
                  {me.mfaEnrolled ? (
                    <>
                      <Banner kind="success" lead="Enabled">Authenticator is enabled.</Banner>
                      {me.mfaPolicyRequired ? (
                        <p className="fc-section-copy">
                          MFA is required on this instance, so authenticator cannot be disabled here.
                          An administrator can clear MFA for account recovery if needed.
                        </p>
                      ) : (
                        <form onSubmit={disableMfa} className="fc-form fc-form--top-rule">
                          <p className="fc-section-copy">To turn it off, confirm your password and a current code.</p>
                          <PasswordField label="Password" value={disPw} onChange={setDisPw} autoComplete="current-password" />
                          <FormField label="Authenticator code" hint="6 digits.">
                            <Input
                              type="text"
                              inputMode="numeric"
                              value={disOtp}
                              onChange={e => setDisOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                              required
                            />
                          </FormField>
                          {disErr && <Banner kind="error">{disErr}</Banner>}
                          <Button type="submit" variant="destructive" fullWidth pending={disBusy} pendingLabel="Disabling…">
                            Disable authenticator
                          </Button>
                        </form>
                      )}
                    </>
                  ) : (
                    <>
                      {!mfa.otpauth ? (
                        <form onSubmit={mfa.start} className="fc-form">
                          <p className="fc-section-copy">
                            Confirm your password before generating a new authenticator secret.
                          </p>
                          <PasswordField label="Password" value={mfa.password} onChange={mfa.setPassword} autoComplete="current-password" />
                          {mfa.error && <Banner kind="error">{mfa.error}</Banner>}
                          <div>
                            <Button type="submit" pending={mfa.busy} pendingLabel="Please wait…">Set up authenticator</Button>
                          </div>
                        </form>
                      ) : (
                        <form onSubmit={mfa.confirm} className="fc-form">
                          <AuthenticatorEnrolment qr={mfa.qr} otpauth={mfa.otpauth} />
                          <FormField label="Authenticator code" hint="The 6-digit code to confirm.">
                            <Input
                              type="text"
                              inputMode="numeric"
                              value={mfa.code}
                              onChange={e => mfa.setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                              required
                            />
                          </FormField>
                          {mfa.error && <Banner kind="error">{mfa.error}</Banner>}
                          <div className="fc-form-actions">
                            <Button variant="secondary" onClick={mfa.cancel}>Cancel</Button>
                            <Button type="submit" pending={mfa.busy} pendingLabel="Confirming…">Confirm</Button>
                          </div>
                        </form>
                      )}
                    </>
                  )}
                </Panel>

                <Panel>
                  <h2 className="fc-section-title">Change password</h2>
                  <form onSubmit={changePw} className="fc-form">
                    <PasswordField label="Current password" value={curPw} onChange={setCurPw} autoComplete="current-password" />
                    <PasswordField
                      label="New password"
                      value={newPw}
                      onChange={setNewPw}
                      autoComplete="new-password"
                      minLength={me.passwordMinLength}
                      hint={
                        newPw.length > 0 && newPw.length < me.passwordMinLength
                          ? `${me.passwordMinLength - newPw.length} more character${me.passwordMinLength - newPw.length === 1 ? "" : "s"} needed.`
                          : `At least ${me.passwordMinLength} characters.`
                      }
                    />
                    <PasswordField
                      label="Confirm new password"
                      value={newPw2}
                      onChange={setNewPw2}
                      autoComplete="new-password"
                      minLength={me.passwordMinLength}
                    />
                    {pwErr && <Banner kind="error">{pwErr}</Banner>}
                    {pwOk && <Banner kind="success" announced>{pwOk}</Banner>}
                    <div className="fc-actions-end">
                      <Button type="submit" pending={pwBusy}>Save</Button>
                    </div>
                  </form>
                </Panel>
              </>
            )}

            {!me.isLocal && (
              <Panel>
                <h2 className="fc-section-title">Sign-in security</h2>
                <Banner kind="info">
                  Your organisation manages Microsoft sign-in and any extra security (such as their MFA).
                  Password and authenticator settings in FamilyChart apply only to local accounts.
                </Banner>
              </Panel>
            )}

            {deviceLockEligible && (
              <Panel>
                <h2 className="fc-section-title">App lock</h2>
                <p className="fc-section-copy">
                  FamilyChart re-locks this device after you leave the app, and asks you to
                  unlock with your device — usually fingerprint, face, or screen lock. This
                  setting applies only to this device.
                </p>

                <form
                  onSubmit={e => {
                    e.preventDefault()
                    saveGracePeriod(gracePeriod)
                  }}
                  id="app-lock-grace-form"
                  className="fc-form"
                >
                  <FormField label="Grace period" hint="How long you can switch to another app and come back without unlocking again.">
                    <Select value={gracePeriod} onChange={e => setGracePeriod(e.target.value as AppLockGracePeriod)}>
                      <option value="immediate">Immediately</option>
                      <option value="30s">30 seconds</option>
                      <option value="1m">1 minute</option>
                      <option value="5m">5 minutes</option>
                    </Select>
                  </FormField>
                  <div className="fc-actions-end">
                    <Button type="submit">Save</Button>
                  </div>
                </form>
                {graceSaveOk && <Banner kind="success" announced>{graceSaveOk}</Banner>}

                <Toggle
                  label="Disable App lock on this device"
                  checked={appLockDisabledOnDevice}
                  onChange={onToggleAppLockDisabled}
                />
                {showAppLockReauth && (
                  <div className="fc-subform">
                    <p className="fc-section-copy">
                      Confirm it&rsquo;s you before turning off App lock on this device.
                    </p>
                    {me.isLocal ? (
                      <form onSubmit={confirmDisableAppLock} className="fc-form">
                        <PasswordField label="Current password" value={reauthPassword} onChange={setReauthPassword} autoComplete="current-password" />
                        {me.mfaEnrolled && (
                          <FormField label="Authenticator code" hint="6 digits.">
                            <Input
                              type="text"
                              inputMode="numeric"
                              value={reauthOtp}
                              onChange={e => setReauthOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                              required
                            />
                          </FormField>
                        )}
                        {reauthErr && <Banner kind="error">{reauthErr}</Banner>}
                        <div className="fc-form-actions">
                          <Button variant="secondary" onClick={() => setShowAppLockReauth(false)}>Cancel</Button>
                          <Button type="submit" pending={reauthBusy} pendingLabel="Confirming…">Confirm</Button>
                        </div>
                      </form>
                    ) : (
                      <div className="fc-form-actions">
                        <Button variant="secondary" onClick={() => setShowAppLockReauth(false)}>Cancel</Button>
                        <Button onClick={confirmWithMicrosoft}>Sign in with Microsoft to confirm</Button>
                      </div>
                    )}
                  </div>
                )}

                {appLockDisabledOnDevice && (
                  <Banner kind="warning">
                    App lock is off on this device only. Anyone who can pick up this device while
                    you&rsquo;re signed in can open FamilyChart without unlocking. Only turn this
                    off if it keeps failing here — your other devices are unaffected.
                  </Banner>
                )}
              </Panel>
            )}
            <RemoveMyAccount isLocal={me.isLocal} mfaEnrolled={me.mfaEnrolled} linked={Boolean(linked)} />
          </>
        )}

        {tab === "settings" && me.hydrationGoalMl != null && linked && (
          <>
            <Panel>
              <h2 className="fc-section-title">Your timezone</h2>
              <p className="fc-section-copy">
                Hydration reminders use this clock for your active window and daily totals. Leave blank
                to use the household default.
              </p>
              {timezoneLoadErr && <Banner kind="error">{timezoneLoadErr}</Banner>}
              {!timezoneLoadErr && effectiveTimezone === null && <p className="fc-field__hint">Loading…</p>}
              {effectiveTimezone && (
                <form onSubmit={saveTimezone} className="fc-form">
                  <FormField
                    label="IANA timezone"
                    optional
                    hint={
                      effectiveTimezone.source === "user"
                        ? `Reminders use your timezone (${effectiveTimezone.tz}).`
                        : effectiveTimezone.source === "instance"
                          ? `Using household default (${effectiveTimezone.tz}).`
                          : "No valid timezone — hydration reminders are paused until one is set."
                    }
                  >
                    <Input
                      type="text"
                      list="profile-iana-tz-list"
                      value={userTimezone}
                      onChange={e => setUserTimezone(e.target.value)}
                      placeholder="e.g. Australia/Sydney"
                    />
                    <datalist id="profile-iana-tz-list">
                      {IANA_TIMEZONES.map(tz => (
                        <option key={tz} value={tz} />
                      ))}
                    </datalist>
                  </FormField>
                  {timezoneSaveErr && <Banner kind="error">{timezoneSaveErr}</Banner>}
                  {timezoneSaveOk && <Banner kind="success" announced>{timezoneSaveOk}</Banner>}
                  <div className="fc-actions-end">
                    <Button type="submit" pending={timezoneSaving}>Save</Button>
                  </div>
                </form>
              )}
            </Panel>

            <Panel>
              <h2 className="fc-section-title">Hydration pacing</h2>
              <p className="fc-section-copy">Set your active hours and usual glass size for hydration reminders.</p>
              {hydrationLoadErr && <Banner kind="error">{hydrationLoadErr}</Banner>}
              {!hydrationLoadErr && hydrationConfig === null && <p className="fc-field__hint">Loading…</p>}
              {hydrationConfig && (
                <form onSubmit={saveHydrationSettings} className="fc-form">
                  <p className="fc-section-copy">
                    <strong>Daily target:</strong> {formatHydration(me.hydrationGoalMl)} —{" "}
                    <Link href={`/${linked.id}/schedules-goals`} className="fc-link">Edit in Schedules &amp; Goals</Link>
                  </p>
                  <div className="fc-form-pair">
                    <FormField label="Active window start">
                      <Input type="time" value={activeStart} onChange={e => setActiveStart(e.target.value)} required />
                    </FormField>
                    <FormField label="Active window end">
                      <Input type="time" value={activeEnd} onChange={e => setActiveEnd(e.target.value)} required />
                    </FormField>
                  </div>
                  <FormField label="Usual glass size (mL)">
                    <Input type="number" min={1} step={1} value={glassSize} onChange={e => setGlassSize(e.target.value)} required />
                  </FormField>
                  {hydrationSaveErr && <Banner kind="error">{hydrationSaveErr}</Banner>}
                  {hydrationSaveOk && <Banner kind="success" announced>{hydrationSaveOk}</Banner>}
                  <div className="fc-actions-end">
                    <Button type="submit" pending={hydrationSaving}>Save</Button>
                  </div>
                </form>
              )}
            </Panel>
          </>
        )}

        {tab === "settings" && me.hydrationGoalMl == null && (
          <EmptyState icon={EMPTY_STATE_ICONS.noRecords} heading="No settings yet">
            There are no user settings available right now.
          </EmptyState>
        )}
      </PageContainer>
      <AppFooter />
    </div>
  )
}
