// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import { describeTimingPrompt, type NeedsPromptTiming } from "@/lib/schedule/dose-timing-prompt"
import type { PromptAnswer } from "@/lib/schedule/slot-outcomes"

/**
 * The "Which dose was this?" prompt on the record screen, shown after Save for a dose outside every
 * slot window. The dose is already saved, so nothing here blocks; leaving unanswered keeps it as an
 * extra dose. The message is plain text so the banner is announced to screen readers when it appears.
 */
export default function TimingPromptBanner({
  timing,
  answering,
  error,
  onAnswer,
}: {
  timing: NeedsPromptTiming
  /** The answer being saved, if any; further clicks are ignored meanwhile. */
  answering: PromptAnswer | null
  error: string
  onAnswer: (answer: PromptAnswer) => void
}) {
  const prompt = describeTimingPrompt(timing)
  return (
    <div className="fc-form">
      <Banner kind="warning" lead={prompt.lead} announced>
        {prompt.message}
      </Banner>
      {error && <Banner kind="error">{error}</Banner>}
      <div className="fc-actions-end">
        {prompt.options.map(option => (
          <Button
            key={option.answer}
            variant="secondary"
            pending={answering === option.answer}
            onClick={() => {
              if (answering === null) onAnswer(option.answer)
            }}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
