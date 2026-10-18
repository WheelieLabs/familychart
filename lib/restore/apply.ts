// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { logDataEvent } from "@/lib/data-event-log"
import { sendOutboundEmail } from "@/lib/email-send"
import type { AppUser } from "@/lib/session"
import { deleteUpload, writeUpload } from "@/lib/uploads/store"
import { assessRestore, RestoreError, type Assessment, type RestoreDecisions } from "./restore-engine"
import { discardStaged, type StagedExport } from "./stage-store"
import { ZipFile } from "./zip-file"

const ROLLED_BACK = "Restore failed — all changes rolled back"

/**
 * Applies confirmed decisions in one transaction, then writes this restore's files.
 * A database error rolls the transaction back. A file error removes the files this
 * restore wrote and reports which one failed.
 */
export async function applyStagedRestore(
  db: Database.Database,
  staged: StagedExport,
  decisions: RestoreDecisions,
  actorEmail: string | null,
  actorRole: string,
  inviter: AppUser,
  origin: string,
) {
  let assessment: Assessment | undefined
  try {
    db.transaction(() => {
      assessment = assessRestore(db, staged, decisions, { actorEmail, inviter, origin })
    })()
  } catch (err) {
    logDataEvent({
      event: "restore_applied",
      outcome: "failed",
      actorRole,
      protected: staged.manifest.protected === true,
      counts: { persons: 0, records: 0, attachments: 0 },
    })
    if (err instanceof RestoreError) throw err
    throw new RestoreError(ROLLED_BACK, 500)
  }
  if (!assessment) throw new RestoreError(ROLLED_BACK, 500)

  const written: typeof assessment.file_jobs = []
  let failed: string | null = null
  const zip = ZipFile.open(staged.path)
  try {
    for (const job of assessment.file_jobs) {
      const bytes = zip.read(job.zipPath)
      if (!bytes) {
        failed = job.bundlePath
        break
      }
      try {
        await writeUpload(job.bucket, job.filename, bytes)
        written.push(job)
      } catch {
        failed = job.bundlePath
        await deleteUpload(job.bucket, job.filename).catch(() => false)
        break
      }
    }
  } finally {
    zip.close()
  }

  if (failed) {
    for (const job of written) await deleteUpload(job.bucket, job.filename).catch(() => false)
    for (const job of assessment.file_jobs) {
      if (job.bucket === "people") {
        db.prepare("UPDATE people SET photo_url = NULL WHERE photo_url = ?").run(job.url)
      } else {
        db.prepare("UPDATE test_events SET attachment_url = NULL WHERE attachment_url = ?").run(job.url)
      }
    }
    logDataEvent({
      event: "restore_applied",
      outcome: "failed",
      actorRole,
      protected: staged.manifest.protected === true,
      counts: {
        persons: assessment.created.persons,
        records: assessment.counts.new - assessment.created.persons,
        attachments: assessment.file_jobs.length,
      },
    })
    throw new RestoreError("Restore failed while writing files", 500, { files_failed: [failed] })
  }

  let emails_sent = 0
  let emails_failed = 0
  let signInEmailsFailed = 0
  if (assessment.pending_invite_mails?.length) {
    for (const pending of assessment.pending_invite_mails) {
      const sent = await sendOutboundEmail(db, pending.mail)
      if (pending.kind === "person_sign_in") {
        if (!sent.ok) signInEmailsFailed += 1
      } else if (sent.ok) emails_sent += 1
      else emails_failed += 1
    }
  }
  if (assessment.accounts_result && assessment.accounts_result.status === "applied") {
    assessment.accounts_result.emails_sent = emails_sent
    assessment.accounts_result.emails_failed = emails_failed
  }
  if (signInEmailsFailed && assessment.user_settings !== "not restored") {
    const noun = signInEmailsFailed === 1 ? "invite email" : "invite emails"
    assessment.user_settings.lines.push(
      `${signInEmailsFailed} ${noun} could not be sent — use Resend on Administration → Accounts.`,
    )
  }

  discardStaged(staged.id)
  logDataEvent({
    event: "restore_applied",
    outcome: "applied",
    actorRole,
    protected: staged.manifest.protected === true,
    counts: {
      persons: assessment.created.persons,
      records: assessment.counts.new - assessment.created.persons,
      attachments: assessment.file_jobs.length,
    },
  })
  const { file_jobs: _jobs, pending_invite_mails: _mails, ...result } = assessment
  return result
}
