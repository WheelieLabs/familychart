# ADR-0008: Audit log coverage and health-data redaction

**Status:** Accepted — v0.44.1

## Context

The `audit_log` table records who changed what for compliance and operator forensics. Details are stored as JSON. Some routes previously copied health-record fields (`value`, `unit`, `dosage`) into audit details on UPDATE, which duplicates sensitive clinical data outside the primary tables.

Auth-related events (login success/failure, session creation) are handled by NextAuth and are not written to `audit_log` today.

## Decision

### Invariant

**Audit log details must not contain health-record measurement or dose values** — no observation `value`/`unit`/`value_label`, no medication-record `dosage`/`dosage_unit`, and no free-text `comments` from those entities. Metadata needed for traceability (entity ids, `person_id`, `medication_id`, `observation_type`, `recorded_at` timestamps) is allowed.

Configuration and catalogue data (medication names, goal thresholds, schedule JSON, settings) are not considered health-record *values* for this invariant.

Registry **secret** settings are already audited as `{ key, changed: true }` only (`lib/settings/app-settings-store.ts`).

### Health entity audit shape

| Entity | CREATE / UPDATE details (allowed) |
|--------|-----------------------------------|
| `observations` | `{ person_id, observation_type }`; UPDATE may include `recorded_at` |
| `medication_records` | `{ person_id, medication_id }`; UPDATE may include `recorded_at` |

DELETE actions use `{}` or entity id only.

### Auth and security inventory

| Event | Audited? | Where |
|-------|----------|-------|
| Account create / invite / role change / deactivate | Yes | `app/api/accounts/invites` (invite CREATE), `app/api/local-users/` (legacy password create), `app/api/accounts/[id]` (role / deactivate); invite accept / revoke / resend and Entra invite-claim also `auditLog` `accounts` |
| Admin clears MFA on another user | Yes | `app/api/accounts/[id]` (`clear_mfa`) |
| Self-service password change | Yes | `app/api/me/password` (`password_changed: true`) |
| Self-service MFA enroll / disable | Yes | `app/api/me/mfa/confirm`, `me/mfa/disable` |
| Setup wizard complete | Yes | `setSetupComplete()` → `system_config` UPDATE |
| Sign-in success / failure | **No** | NextAuth only (no `audit_log` row) |
| Sign-out | **No** | NextAuth only |
| Entra / OIDC token exchange | **No** | NextAuth only |
| Session refresh | **No** | NextAuth only |

Future work may add explicit `LOGIN` / `LOGIN_FAILED` rows; that is out of scope for this ADR.

### Other audited domains (no health values)

- **People / profile:** name, DOB, linkage metadata — demographic/profile fields, not dose/measurement values.
- **Import:** counts only (`medication_records`, `observations_created`).
- **Observation goals:** threshold configuration (`target_value`), not recorded measurements.
- **Favourites, medications catalogue, frequency rules, expectations:** configuration and labels only.

## Consequences

- Operators can trace *that* a dose or observation was edited, for whom, and when, without a second copy of clinical values in `audit_log`.
- Login forensics still require web-server or IdP logs until auth events are added to `audit_log`.
- New API: grep for `auditLog(` and avoid copying health-record value fields into `details`.

## References

- `auditLog()` in [`lib/audit-log.ts`](../../lib/audit-log.ts)
- Architecture: [`docs/architecture.md`](../architecture.md) — Database → Audit log
