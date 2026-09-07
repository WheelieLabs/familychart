# ADR-0003: Database encryption modes

**Status:** Accepted (implemented v0.45.0; file uploads extended v0.57.0)  
**Tracking:** GitHub Project 1 (Encrypted database at rest); file uploads tracked separately in the dev backlog

## Context

Self-hosters may want optional at-rest encryption; managed SaaS requires key-server-backed encryption with no plaintext fallback. Person photos under `uploads/people/` sit beside the DB on the same volume and must share the same security boundary.

## Decision

Explicit selector `FC_ENCRYPTION_MODE = none | env | keyserver`:

| Mode | Who | DB passphrase | File passphrase | Key server |
|------|-----|---------------|-----------------|------------|
| `none` | Self-host default | — | — | absent |
| `env` | Self-host opt-in | `FC_DB_KEY` | `FC_FILE_KEY` | absent |
| `keyserver` | Managed only | unwrap `DB_WRAPPED_KEY` | unwrap `FILE_WRAPPED_KEY` | required |

Boot asserts per mode. A failed keyserver unwrap **halts** — never degrades to plaintext. Missing file key when mode ≠ `none` also **halts**. In `keyserver` mode, `DB_KEY_SERVER_URL` must use the `https://` scheme (fail-closed on plain `http://`).

File cipher: AES-256-GCM with inline `FCE1` header (version byte + 12-byte nonce + ciphertext‖tag). Plaintext existing uploads are encrypted on boot. The file key is **independent** of the DB key (separate rotation / blast radius). The key server can mint additional wraps for rotation without invalidating the existing one.

Env-only (not in `app_settings` registry): `FC_ENCRYPTION_MODE`, `FC_DB_KEY`, `FC_FILE_KEY`, key-server URL, `DB_WRAPPED_KEY`, `FILE_WRAPPED_KEY`.

## Consequences

- Managed-hosting provisioning must write consistent values for these env vars across the platform — internal detail: `docs-internal/managed-hosting.md`.
- Implementation tracked in wave 7 / Project 1 (DB); Wave 5 (file uploads).
