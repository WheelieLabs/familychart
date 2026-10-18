// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A scheduled dose that was never recorded (a Missed slot), as returned by `GET /api/dose-missed`.
 * History only: it is not a medication record and affects no safety check.
 */
export interface DoseMissedSummary {
  /** `slot:<n>` for a slot outcome, `answer:<n>` for a "Not given" answer from before slot outcomes. */
  id: string
  person_id: number
  medication_name: string
  /** The slot time the dose was due. */
  recorded_at: string
  /** Why the slot is Missed: the next slot started or the day ended, "Not given", or an Early answer. */
  cause: "timed_out" | "not_given" | "early_answer"
}
