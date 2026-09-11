// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { auditLog } from "@/lib/audit-log"
import { logger } from "@/lib/logger"
import { isManagedPlatformProfile } from "@/lib/platform-profile"
import { isBootstrapEndpointAllowed } from "@/lib/setup-bootstrap"
import { isEntraProviderActive } from "@/lib/settings/auth-settings"
import { resolveSetting } from "@/lib/settings/resolver"
import { SETTING_SECURITY_PASSWORD_MIN_LENGTH } from "@/lib/settings/registry"
import { localUserNeedsMfaEnrollment } from "@/lib/account/account-local-reauth"
import { hasAnyLocalAccount, hasLocalAdminAccount } from "@/lib/local-account-gate"

export const SETUP_COMPLETE_KEY = "setup_complete"

export function isSetupComplete(db: Database.Database): boolean {
  const row = db
    .prepare("SELECT value FROM system_config WHERE key = ?")
    .get(SETUP_COMPLETE_KEY) as { value: string | null } | undefined
  return row?.value === "1"
}

export function setSetupComplete(db: Database.Database, userEmail: string | null | undefined): void {
  db.prepare(
    `INSERT INTO system_config (key, value, updated_at) VALUES (?, '1', CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  ).run(SETUP_COMPLETE_KEY)
  auditLog(db, userEmail, "UPDATE", "system_config", null, { setup_complete: true })
  logger.info("setup_complete", { actor: userEmail ?? null })
}

/**
 * Sentinel recording that an administrator has authenticated (or been created). Set on the
 * first admin-group Entra sign-in so the unauthenticated `/api/setup/bootstrap` window closes
 * on mixed Entra+credentials instances even when no local admin is ever created.
 * Distinct from `setup_complete`, which also gates required timezone setup (ADR-0002) and must
 * not be auto-set on SSO login.
 */
export const ADMIN_SEEN_KEY = "admin_seen"

export function isAdminSeen(db: Database.Database): boolean {
  const row = db
    .prepare("SELECT value FROM system_config WHERE key = ?")
    .get(ADMIN_SEEN_KEY) as { value: string | null } | undefined
  return row?.value === "1"
}

/** One-time write of the admin-seen sentinel (idempotent). */
export function markAdminSeen(db: Database.Database): void {
  db.prepare(
    `INSERT INTO system_config (key, value, updated_at) VALUES (?, '1', CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO NOTHING`
  ).run(ADMIN_SEEN_KEY)
}

export type SetupWizardMode = "self-host" | "managed"
export type SetupStepKey = "account" | "mfa" | "person" | "timezone" | "smtp"

export interface SetupSessionInfo {
  authenticated: boolean
  isAdmin: boolean
  entraSession: boolean
  localUserId: number | null
  email: string | null
}

export interface SetupWizardContext {
  complete: boolean
  passwordMinLength: number
  mode: SetupWizardMode
  stage1Ready: boolean
  bootstrapAllowed: boolean
  ssoFinishEligible: boolean
  showPersonStep: boolean
  showSmtpStep: boolean
  showMfaStep: boolean
  authenticated: boolean
  currentUserEmail: string | null
  entraSignInAvailable: boolean
  steps: SetupStepKey[]
  displaySteps: SetupStepKey[]
  initialStep: SetupStepKey
}

export function isStage1AdminReady(db: Database.Database): boolean {
  if (isManagedPlatformProfile()) return hasLocalAdminAccount(db)
  if (isAdminSeen(db)) return true
  return hasAnyLocalAccount(db)
}

function hasAnyPerson(db: Database.Database): boolean {
  const row = db.prepare("SELECT id FROM people LIMIT 1").get()
  return !!row
}

function buildManagedStage2Steps(showPersonStep: boolean, showMfaStep: boolean): SetupStepKey[] {
  const steps: SetupStepKey[] = []
  if (showMfaStep) steps.push("mfa")
  if (showPersonStep) steps.push("person")
  steps.push("timezone")
  return steps
}

export function buildSetupSteps(input: {
  mode: SetupWizardMode
  stage1Ready: boolean
  bootstrapAllowed: boolean
  entraSignInAvailable: boolean
  showPersonStep: boolean
  showSmtpStep: boolean
  showMfaStep: boolean
}): SetupStepKey[] {
  if (input.mode === "managed") {
    if (!input.stage1Ready) return ["timezone"]
    return buildManagedStage2Steps(input.showPersonStep, input.showMfaStep)
  }

  const steps: SetupStepKey[] = []
  if (input.bootstrapAllowed || (!input.stage1Ready && input.entraSignInAvailable)) {
    steps.push("account")
  }
  if (input.stage1Ready) {
    if (input.showMfaStep) steps.push("mfa")
    if (input.showPersonStep) steps.push("person")
    steps.push("timezone")
    if (input.showSmtpStep) steps.push("smtp")
  }
  return steps.length > 0 ? steps : ["account"]
}

/** Full step sequence for the progress UI (managed vs self-host). */
export function buildSetupDisplaySteps(input: {
  mode: SetupWizardMode
  showPersonStep: boolean
  showSmtpStep: boolean
  showAccountStep: boolean
  showMfaStep: boolean
}): SetupStepKey[] {
  if (input.mode === "managed") {
    const stage2 = buildManagedStage2Steps(input.showPersonStep, input.showMfaStep)
    if (input.showAccountStep) return ["account", ...stage2]
    return stage2
  }

  const steps: SetupStepKey[] = []
  if (input.showAccountStep) steps.push("account")
  if (input.showMfaStep) steps.push("mfa")
  if (input.showPersonStep) steps.push("person")
  steps.push("timezone")
  if (input.showSmtpStep) steps.push("smtp")
  return steps.length > 0 ? steps : ["account"]
}

function resolveInitialStep(
  steps: SetupStepKey[],
  input: {
    mode: SetupWizardMode
    ssoFinishEligible: boolean
    stage1Ready: boolean
    personAlreadyAdded: boolean
  },
): SetupStepKey {
  if (input.personAlreadyAdded && steps.includes("person")) {
    if (steps.includes("timezone")) return "timezone"
    if (steps.includes("smtp")) return "smtp"
  }
  if (input.mode === "managed") {
    if (steps.includes("mfa")) return "mfa"
    if (steps.includes("person")) return "person"
    return "timezone"
  }
  if (input.ssoFinishEligible) {
    if (steps.includes("person")) return "person"
    return "timezone"
  }
  if (input.stage1Ready) {
    if (steps.includes("mfa")) return "mfa"
    if (steps.includes("person")) return "person"
    return "timezone"
  }
  return steps[0] ?? "account"
}

export function getSetupWizardContext(
  db: Database.Database,
  session: SetupSessionInfo,
): SetupWizardContext {
  const complete = isSetupComplete(db)
  const managed = isManagedPlatformProfile()
  const mode: SetupWizardMode = managed ? "managed" : "self-host"
  const stage1Ready = isStage1AdminReady(db)
  const bootstrapAllowed = isBootstrapEndpointAllowed() && !stage1Ready
  const entraSignInAvailable = isEntraProviderActive(db)
  const showPersonStep = true
  const showSmtpStep = !managed
  const showMfaStep =
    !session.entraSession &&
    session.localUserId != null &&
    localUserNeedsMfaEnrollment(db, session.localUserId)

  const ssoFinishEligible =
    !complete &&
    !managed &&
    session.authenticated &&
    session.isAdmin &&
    session.entraSession &&
    stage1Ready

  const needsSignIn = stage1Ready && !session.authenticated

  const steps = needsSignIn
    ? (["account"] as SetupStepKey[])
    : buildSetupSteps({
        mode,
        stage1Ready,
        bootstrapAllowed,
        entraSignInAvailable,
        showPersonStep,
        showSmtpStep,
        showMfaStep,
      })

  const displaySteps = buildSetupDisplaySteps({
    mode,
    showPersonStep,
    showSmtpStep,
    showAccountStep: needsSignIn || (!managed && !ssoFinishEligible),
    showMfaStep,
  })

  const initialStep = needsSignIn
    ? "account"
    : resolveInitialStep(steps, {
        mode,
        ssoFinishEligible,
        stage1Ready,
        personAlreadyAdded: hasAnyPerson(db),
      })

  const passwordMinLength = parseInt(resolveSetting(db, SETTING_SECURITY_PASSWORD_MIN_LENGTH).value, 10)

  return {
    complete,
    passwordMinLength,
    mode,
    stage1Ready,
    bootstrapAllowed,
    ssoFinishEligible,
    showPersonStep,
    showSmtpStep,
    showMfaStep,
    authenticated: session.authenticated,
    currentUserEmail: session.email,
    entraSignInAvailable,
    steps,
    displaySteps,
    initialStep,
  }
}
