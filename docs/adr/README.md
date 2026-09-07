# Architecture Decision Records

Durable decisions for the FamilyChart app (`familychart-dev`). Supersede with a new ADR — do not delete history.

| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-settings-registry.md) | Settings registry and env-wins precedence | Accepted — fully implemented |
| [0002](0002-instance-setup-gate.md) | Two-stage instance setup gate | Accepted — fully implemented |
| [0003](0003-database-encryption-modes.md) | Database encryption modes | Accepted — not yet implemented |
| [0004](0004-managed-platform-profile.md) | Managed platform profile and modular auth | Accepted — fully implemented |
| [0005](0005-demo-mode-platform-guard.md) | Demo mode platform guard and in-app moderation | Accepted — v0.43.0 |
| [0006](0006-environment-variable-inventory.md) | Environment variable inventory (ecosystem) | Accepted — Wave 6 |
| [0007](0007-reverse-proxy-mode.md) | Unified reverse-proxy deployment mode | Accepted — Wave 6 |
| [0008](0008-audit-log-coverage.md) | Audit log coverage and health-data redaction | Accepted — v0.44.1 |
| [0009](0009-entra-live-revocation.md) | Entra live revocation (background revalidation + admin instant revoke) | Accepted — v0.51.0 |
| [0010](0010-entra-provider-request-scoped-config.md) | Entra provider resolved from request-scoped NextAuth config | Accepted — v0.51.1 |
| [0011](0011-prn-rules-are-alerts-not-write-gates.md) | PRN cooldown and 24h caps are alerts, not dose-write gates | Accepted — v0.52.0, won't-fix |
| [0012](0012-curated-observation-catalogue.md) | Curated observation catalogue with instance-wide hide/show | Accepted — v0.56.0 |
| [0013](0013-public-export-scope-manifest.md) | Public-export scope manifest | Accepted — pre-v1.0.0 |
| [0014](0014-managed-admin-forced-reset-first-login.md) | Managed admin forced-reset first-login flow | Accepted — fully implemented |
| [0015](0015-accounts-unification.md) | Canonical `accounts` table and invite-based onboarding | Accepted |

**Active implementation:** App UI Settings project (internal issue tracker).

**Managed-hosting provisioning and billing decisions:** internal — see `docs-internal/managed-hosting.md` (not part of the public export).
