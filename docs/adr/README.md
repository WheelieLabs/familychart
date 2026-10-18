# Architecture Decision Records

Durable decisions for the FamilyChart app (`familychart-dev`). Supersede with a new ADR — do not delete history.

| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-settings-registry.md) | Settings registry and env-wins precedence | Accepted — fully implemented |
| [0002](0002-instance-setup-gate.md) | Two-stage instance setup gate | Accepted — fully implemented |
| [0003](0003-database-encryption-modes.md) | Database encryption modes | Accepted — v0.45.0 (file uploads v0.57.0) |
| [0004](0004-managed-platform-profile.md) | Managed platform profile and modular auth | Accepted — fully implemented |
| [0005](0005-demo-mode-platform-guard.md) | Demo mode platform guard and in-app moderation | Accepted — v0.43.0 |
| [0006](0006-environment-variable-inventory.md) | Environment variable inventory (ecosystem) | Accepted — Wave 6 |
| [0007](0007-reverse-proxy-mode.md) | Unified reverse-proxy deployment mode | Accepted — Wave 6 |
| [0008](0008-audit-log-coverage.md) | Audit log coverage and health-data redaction | Accepted — v0.44.1 |
| [0009](0009-entra-live-revocation.md) | Entra live revocation (background revalidation + admin instant revoke) | Accepted — v0.51.0 |
| [0010](0010-entra-provider-request-scoped-config.md) | Entra provider resolved from request-scoped NextAuth config | Accepted — v0.51.1 |
| [0011](0011-prn-rules-are-alerts-not-write-gates.md) | PRN cooldown and 24h caps are alerts, not dose-write gates | Accepted — v0.52.0, won't-fix; amended in 1.1.0 |
| [0012](0012-curated-observation-catalogue.md) | Curated observation catalogue with instance-wide hide/show | Accepted — v0.56.0 |
| [0013](0013-public-export-scope-manifest.md) | Public-export scope manifest | Accepted — pre-v1.0.0 |
| [0014](0014-managed-admin-forced-reset-first-login.md) | Managed admin forced-reset first-login flow | Accepted — fully implemented |
| [0015](0015-accounts-unification.md) | Canonical `accounts` table and invite-based onboarding | Accepted |
| [0016](0016-app-lock-device-bound-credential.md) | App lock uses a device-bound credential, not a passkey | Accepted — implemented in 1.1.0 |
| [0017](0017-dose-expectations.md) | Dose expectations — derived pending state, confirmed at the slot time | Accepted — implemented |
| [0018](0018-dev-only-lint-chain-audit-exception.md) | Accept the dev-only `braces` advisory in the ESLint chain | Accepted — revisit when upstream fixes |
| [0019](0019-test-metric-catalogue.md) | Test metric catalogue — curated, alias-bearing, typed, with limit qualifiers | Accepted |
| [0020](0020-text-layer-pdf-prefill.md) | Text-layer PDF prefill for Record Test Result runs on the phone with self-hosted pdf.js | Accepted |
| [0021](0021-report-redaction-before-upload.md) | Report attachments are redacted on the phone before they are stored | Accepted — implemented |
| [0022](0022-none-household-role.md) | Household Role None is the sentinel `none` | Accepted |
| [0023](0023-centralised-ui-components-and-enforcement.md) | Centralised UI components, tokens and lint enforcement | Accepted |
| [0024](0024-aa-target-sizes-and-card-density.md) | Target sizes follow WCAG 2.2 AA, with 44px kept for primary controls | Accepted |
| [0025](0025-person-erase.md) | Person erase is a hard delete with audit content blanked | Accepted — engine and confirmation screen implemented |
| [0026](0026-household-export-and-restore.md) | Household export and restore: versioned, forwards-only | Accepted — documented for 1.1.0 |
| [0027](0027-account-removal.md) | Permanent Account removal pseudonymises the actor and tombstones Entra | Accepted |
| [0028](0028-export-format.md) | Exports are streamed, versioned zips led by a manifest | Accepted — Person and Household exports implemented |
| [0029](0029-dose-timing-and-missed.md) | Dose timing is stored per slot, and Missed is information, never an alert | Accepted — 1.1.0 |
| [0030](0030-self-dose-and-hydration-notifications.md) | The recorder's own notifications update and clear, quietly where they can | Accepted — 1.1.0 |

**Active implementation:** App UI Settings project (internal issue tracker).

**Managed-hosting provisioning and billing decisions:** internal — see `docs-internal/managed-hosting.md` (not part of the public export).
