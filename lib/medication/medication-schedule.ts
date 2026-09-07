// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Re-export shim. Import directly from schedule-recurrence or schedule-input where possible.
 * - Computation callers (cron, dashboard, records history): use @/lib/schedule-recurrence
 * - HTTP input callers (person-medications route): use @/lib/schedule-input
 */
export { parseHHMM, formatHHMM, parseScheduleTimeUserInput } from "@/lib/datetime"
export * from "@/lib/schedule/schedule-recurrence"
export * from "@/lib/schedule/schedule-input"
