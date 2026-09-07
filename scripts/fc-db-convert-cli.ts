#!/usr/bin/env npx tsx
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * FamilyChart database encryption converter CLI.
 */

import path from "node:path"
import process from "node:process"
import { convertDatabaseEncryption } from "../lib/encryption/convert-orchestrator"
import type { EncryptionMode } from "../lib/encryption/mode"
import type { KeyConfig } from "../lib/encryption/key-config"

function usage(): never {
  console.error(`Usage: fc-db-convert --from <none|env|keyserver> --to <none|env|keyserver> \\
  --source <path> [--target <path>] [--in-place] [--from-key <hex>] [--to-key <hex>]
  Keys may also be supplied via FC_CONVERT_FROM_KEY / FC_CONVERT_TO_KEY (preferred under Docker).`)
  process.exit(1)
}

function parseArgs(argv: string[]) {
  const opts = {
    from: "" as EncryptionMode | "",
    to: "" as EncryptionMode | "",
    source: "",
    target: "",
    inPlace: false,
    fromKey: "",
    toKey: "",
  }
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!
    const next = argv[i + 1]
    switch (arg) {
      case "--from":
        opts.from = next as EncryptionMode
        i++
        break
      case "--to":
        opts.to = next as EncryptionMode
        i++
        break
      case "--source":
        opts.source = next ?? ""
        i++
        break
      case "--target":
        opts.target = next ?? ""
        i++
        break
      case "--in-place":
        opts.inPlace = true
        break
      case "--from-key":
        opts.fromKey = next ?? ""
        i++
        break
      case "--to-key":
        opts.toKey = next ?? ""
        i++
        break
      case "--help":
      case "-h":
        usage()
        break
      default:
        console.error(`Unknown argument: ${arg}`)
        usage()
    }
  }
  if (!opts.from || !opts.to || !opts.source) usage()
  if (!opts.inPlace && !opts.target) usage()
  return opts as {
    from: EncryptionMode
    to: EncryptionMode
    source: string
    target: string
    inPlace: boolean
    fromKey: string
    toKey: string
  }
}

function buildKeyConfig(mode: EncryptionMode, inlineKey: string): KeyConfig {
  if (mode === "none") return { mode: "none", source: "none" }
  if (inlineKey) return { mode, source: "inline", inlinePassphrase: inlineKey }
  return { mode, source: mode }
}

async function main() {
  const opts = parseArgs(process.argv)
  // Prefer env for keys when invoked under Docker so secrets are not on argv.
  if (!opts.fromKey && process.env.FC_CONVERT_FROM_KEY) {
    opts.fromKey = process.env.FC_CONVERT_FROM_KEY
  }
  if (!opts.toKey && process.env.FC_CONVERT_TO_KEY) {
    opts.toKey = process.env.FC_CONVERT_TO_KEY
  }
  const sourcePath = path.resolve(opts.source)
  const targetPath = opts.inPlace ? sourcePath : path.resolve(opts.target)

  const result = await convertDatabaseEncryption({
    sourcePath,
    targetPath,
    from: buildKeyConfig(opts.from, opts.fromKey),
    to: buildKeyConfig(opts.to, opts.toKey),
    fromPassphrase: opts.fromKey || undefined,
    toPassphrase: opts.toKey || undefined,
    inPlace: opts.inPlace,
  })

  console.log(JSON.stringify({ ok: true, ...result }))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
