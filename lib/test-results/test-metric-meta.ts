// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import type { TestMetricConfig } from "../domain-types"

export type { TestMetricConfig }

const SELECT_COLUMNS = "id, metric_name, unit, sort_order, is_active, aliases, panel, value_type"

type TestMetricConfigRow = Omit<TestMetricConfig, "aliases"> & { aliases: string | null }

function parseAliases(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === "string") : []
  } catch {
    return []
  }
}

function toConfig(row: TestMetricConfigRow): TestMetricConfig {
  return { ...row, aliases: parseAliases(row.aliases) }
}

export function listTestMetricConfigs(db: Database.Database): TestMetricConfig[] {
  const rows = db.prepare(
    `SELECT ${SELECT_COLUMNS}
       FROM test_metric_config
      ORDER BY sort_order ASC, metric_name ASC`
  ).all() as TestMetricConfigRow[]
  return rows.map(toConfig)
}

export function findTestMetricConfig(
  db: Database.Database,
  metricName: string
): TestMetricConfig | undefined {
  const row = db
    .prepare(
      `SELECT ${SELECT_COLUMNS}
         FROM test_metric_config
        WHERE metric_name = ? COLLATE NOCASE`
    )
    .get(metricName.trim()) as TestMetricConfigRow | undefined
  return row ? toConfig(row) : undefined
}
