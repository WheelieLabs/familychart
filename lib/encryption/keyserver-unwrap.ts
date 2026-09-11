// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared keyserver unwrap transport for DB and file wrapped keys.
 * Passphrase stores stay independent (ADR-0003); only HTTPS/retry/POST /unwrap lives here.
 */

import { logger } from "@/lib/logger"

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000]

export type UnwrapKeyLabel = "db" | "file"

export type UnwrapKeyFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>

export interface UnwrapKeyFromKeyserverOptions {
  wrappedKey: string
  label: UnwrapKeyLabel
  /** Injectable for tests; production uses global fetch. */
  fetcher?: UnwrapKeyFetcher
  /** Injectable for tests; production uses real delay. */
  sleep?: (ms: number) => Promise<void>
}

function labelPrefix(label: UnwrapKeyLabel): string {
  return label === "file" ? "Key server file-key unwrap" : "Key server unwrap"
}

function logEvent(label: UnwrapKeyLabel, kind: "retry" | "failed"): string {
  return label === "file" ? `file_key_unwrap_${kind}` : `db_key_unwrap_${kind}`
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function loadConnectionEnv(): { url: string; token: string; customerId: string } {
  const url = process.env.DB_KEY_SERVER_URL?.trim()
  const token = process.env.DB_KS_TOKEN?.trim()
  const customerId =
    process.env.DB_KS_CUSTOMER_ID?.trim() ||
    process.env.HOST_ID?.trim() ||
    process.env.INSTANCE_SUBDOMAIN?.trim()

  if (!url || !token || !customerId) {
    throw new Error(
      "keyserver mode requires DB_KEY_SERVER_URL, DB_KS_TOKEN, and DB_KS_CUSTOMER_ID (or HOST_ID)",
    )
  }

  if (!url.startsWith("https://")) {
    throw new Error(
      "DB_KEY_SERVER_URL must use https:// in keyserver mode (refusing non-TLS key unwrap)",
    )
  }

  return { url, token, customerId }
}

/**
 * Unwrap a wrapped key via the key server. Fail-closed; never returns empty passphrase.
 */
export async function unwrapKeyFromKeyserver(
  options: UnwrapKeyFromKeyserverOptions,
): Promise<string> {
  const wrappedKey = options.wrappedKey.trim()
  if (!wrappedKey) {
    throw new Error(`${labelPrefix(options.label)} requires a wrapped key`)
  }

  const { url, token, customerId } = loadConnectionEnv()
  const fetcher = options.fetcher ?? fetch
  const sleep = options.sleep ?? defaultSleep
  const prefix = labelPrefix(options.label)

  let lastError: Error | null = null
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetcher(`${url.replace(/\/$/, "")}/unwrap`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ customer_id: customerId, wrapped_key: wrappedKey }),
      })

      if (res.status === 401 || res.status === 403 || res.status === 422) {
        throw new Error(`${prefix} rejected (${res.status})`)
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(`${prefix} failed (${res.status}): ${body.slice(0, 200)}`)
      }

      const data = (await res.json()) as { passphrase?: string }
      const passphrase = data.passphrase?.trim()
      if (!passphrase) {
        throw new Error(`${prefix} returned empty passphrase`)
      }
      return passphrase
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      const retryable =
        attempt < RETRY_DELAYS_MS.length &&
        !(lastError.message.includes("rejected") || lastError.message.includes("empty passphrase"))
      if (retryable) {
        logger.warn(logEvent(options.label, "retry"), {
          attempt: attempt + 1,
          err: lastError.message,
        })
        await sleep(RETRY_DELAYS_MS[attempt]!)
        continue
      }
      break
    }
  }

  logger.error(logEvent(options.label, "failed"), { err: lastError?.message ?? "unknown" })
  throw lastError ?? new Error(`${prefix} failed`)
}
