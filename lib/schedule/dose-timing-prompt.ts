// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Wording and options for the "Which dose was this?" prompt shown after a dose is saved outside every
 * slot window. Pure: the record screen renders what this returns. The slots come from the server's
 * `needs_prompt` timing, so the client never works a slot out itself.
 */

import { formatSlotHhmm } from "@/lib/medication/dose-timing-display"
import type { DoseTiming, PromptAnswer } from "@/lib/schedule/slot-outcomes"

export type NeedsPromptTiming = Extract<DoseTiming, { kind: "needs_prompt" }>

export interface TimingPromptOption {
  answer: PromptAnswer
  label: string
}

export interface TimingPrompt {
  /** The bold lead of the banner. */
  lead: string
  /** Where the dose falls, the question, and what each answer does. One string so it is announced whole. */
  message: string
  options: TimingPromptOption[]
}

/** The prompt data for a saved dose's timing, or null when nothing needs asking. */
export function promptFromTiming(timing: DoseTiming | undefined): NeedsPromptTiming | null {
  return timing?.kind === "needs_prompt" ? timing : null
}

export function describeTimingPrompt(timing: NeedsPromptTiming): TimingPrompt {
  const { previousSlot, nextSlot, earlierOpenSlots } = timing
  const where =
    previousSlot && nextSlot
      ? `between the ${formatSlotHhmm(previousSlot)} and ${formatSlotHhmm(nextSlot)} doses`
      : nextSlot
        ? `before the ${formatSlotHhmm(nextSlot)} dose`
        : `after the ${formatSlotHhmm(previousSlot ?? "")} dose`

  const parts = [`${where}. Which dose was this?`]
  if (nextSlot && earlierOpenSlots.length > 0) parts.push("Early marks earlier open doses as missed.")
  parts.push("If you don't answer, it stays an extra dose.")

  const options: TimingPromptOption[] = []
  if (previousSlot) options.push({ answer: "late", label: `Late ${formatSlotHhmm(previousSlot)}` })
  if (nextSlot) options.push({ answer: "early", label: `Early ${formatSlotHhmm(nextSlot)}` })
  options.push({ answer: "extra", label: "Extra dose" })

  return { lead: "Not at a scheduled time", message: parts.join(" "), options }
}
