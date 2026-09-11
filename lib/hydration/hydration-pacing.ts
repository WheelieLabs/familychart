// SPDX-License-Identifier: AGPL-3.0-only

import { parseHHMM } from "@/lib/datetime"

export type HydrationPacingStatus =
  | "before_window"
  | "on_pace"
  | "behind"
  | "met"
  | "window_closed"

export interface HydrationPacingInput {
  activeStart: number
  activeEnd: number
  glassSize: number
  target: number
  consumed: number
  nowLocalMinutes: number
}

export interface PacingState {
  status: HydrationPacingStatus
  consumed: number
  target: number
  deficit: number
  glassesRemainingTotal: number
  glassesNeededNow: number | null
  catchUpRealistic: boolean
  /** Present only when behind and remaining active time is at least 30 minutes. */
  requiredRate?: number | null
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function hhmmToMinutesSinceMidnight(hhmm: string): number {
  const hm = parseHHMM(hhmm)
  if (!hm) throw new Error(`Invalid HH:MM time: ${hhmm}`)
  return hm.h * 60 + hm.m
}

export function computeHydrationPacing(input: HydrationPacingInput): PacingState {
  const { activeStart, activeEnd, glassSize, target, consumed, nowLocalMinutes } = input

  const remainingVolume = Math.max(0, target - consumed)
  const glassesRemainingTotal = Math.ceil(remainingVolume / glassSize)
  const windowMinutes = activeEnd - activeStart
  const totalActiveHours = windowMinutes / 60

  if (consumed >= target) {
    return {
      status: "met",
      consumed,
      target,
      deficit: 0,
      glassesRemainingTotal: 0,
      glassesNeededNow: null,
      catchUpRealistic: true,
    }
  }

  if (nowLocalMinutes < activeStart) {
    return {
      status: "before_window",
      consumed,
      target,
      deficit: 0,
      glassesRemainingTotal,
      glassesNeededNow: null,
      catchUpRealistic: true,
    }
  }

  const elapsedMinutes = clamp(nowLocalMinutes - activeStart, 0, windowMinutes)
  const elapsedActiveHours = elapsedMinutes / 60
  const expectedByNow = target * (elapsedActiveHours / totalActiveHours)
  const remainingHours = Math.max(0, activeEnd - nowLocalMinutes) / 60

  if (nowLocalMinutes >= activeEnd) {
    return {
      status: "window_closed",
      consumed,
      target,
      deficit: Math.max(0, expectedByNow - consumed),
      glassesRemainingTotal,
      glassesNeededNow: null,
      catchUpRealistic: false,
    }
  }

  if (consumed >= expectedByNow) {
    return {
      status: "on_pace",
      consumed,
      target,
      deficit: 0,
      glassesRemainingTotal,
      glassesNeededNow: null,
      catchUpRealistic: true,
    }
  }

  const deficit = Math.max(0, expectedByNow - consumed)
  const catchUpRealistic = remainingHours >= 0.5
  const requiredRate = catchUpRealistic ? remainingVolume / remainingHours : null

  return {
    status: "behind",
    consumed,
    target,
    deficit,
    glassesRemainingTotal,
    glassesNeededNow: Math.ceil(deficit / glassSize),
    catchUpRealistic,
    requiredRate,
  }
}
