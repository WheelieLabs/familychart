# Encryption runbook

Operational guide for SQLCipher at-rest encryption and instance conversion.

See [ADR-0003](../docs/adr/0003-database-encryption-modes.md) for mode definitions (`none` | `env` | `keyserver`).

## CLI: `fc-db-convert`

Shipped with the app image (v0.45.0+). Converts `familychart.db` between encryption configurations.

```bash
# Self-host: plaintext → env-encrypted
npm run fc-db-convert -- \
  --from none --to env \
  --source ./data/familychart.db \
  --target ./data/familychart.enc.db \
  --to-key "$(openssl rand -hex 32)"
```

Env for keyserver modes: `DB_KEY_SERVER_URL` (**must be `https://`** — boot fails closed on `http://`), `DB_KS_TOKEN`, `DB_WRAPPED_KEY`, `FILE_WRAPPED_KEY`, `DB_KS_CUSTOMER_ID`.

File uploads use the same `FC_ENCRYPTION_MODE`. Env mode also requires `FC_FILE_KEY` (64-char hex). Missing file key when mode ≠ `none` fails closed at boot. Plaintext photos under `uploads/people/` are encrypted automatically on first boot after enabling encryption.

## Managed-hosting conversion, provisioning, and outage procedures

Internal — see `docs-internal/managed-hosting.md`.

## Managed offboarding: keyserver → self-host

1. The managed-hosting platform converts the instance from `keyserver` to `env` mode **while the instance still has keyserver network access**.
2. The platform exports a full instance backup after conversion.
3. Hand the customer:
   - Backup `.tar.gz`
   - Generated `FC_DB_KEY` (from conversion env patch — store securely)
   - [Self-host setup](../README.md#docker-deployment) with `FC_ENCRYPTION_MODE=env` and `FC_DB_KEY`

To export fully plaintext (`none`), use `toMode: "none"` instead — customer receives an unencrypted DB suitable for local-only hosting.

## Keyserver outage

- **Running instances** keep the in-memory key; no immediate data loss.
- **Restarts** fail closed until keyserver is reachable again.
- App health in keyserver mode: `GET /api/health` includes `keyserver: "reachable" | "unreachable"`; `"unreachable"` returns HTTP `503` (`status: "degraded"`), not `200` — a platform can key off either the JSON field or the HTTP status for **alerting**. This is not a kill/restart signal: the Docker healthcheck (and any orchestrator) should treat `503` as container-live the same as `200`, since a running instance that already unwrapped its key keeps working through a keyserver blip and must not be restarted just because polling failed.

## Schema migrations

Boot-time migrations are tracked in `schema_migrations` (v0.45.0+). Each schema change adds one numbered entry in `lib/db-migrations/` — no more per-column `PRAGMA table_info` blocks.
