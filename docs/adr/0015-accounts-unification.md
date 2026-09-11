# ADR-0015: Canonical `accounts` table and invite-based onboarding

**Status:** Accepted; Amended (v1.0.0)  
**Tracking:** Invite-based account onboarding spec (internal issue tracker)

## Context

Creating a sign-in identity and a household-roster Person were three disconnected admin steps: create a row at `/admin/local-users` (admin-chosen password) → create a Person → link them by dropdown. There was no invite. “User” vs “Person” was confusing in UI copy. Federated (Entra) identities had no canonical row for admin-assigned role or Person linking until they happened to be stored as a raw oid on `people.user_uid`.

## Decision

- Rename the auth-identity concept **Account** in UI and code. **Person** stays the household-roster entity.
- Unify `local_users` into **`accounts`**: one row per canonical account, local or Entra. `password_hash` / TOTP columns stay nullable for federated and invited rows. Add `auth_method` (`local` | `entra`), `external_id` (Entra oid), `status` (`invited` | `active`), and invite token/expiry/revoked columns.
- Rename `people.user_uid` → **`people.account_uid`**. Value convention unchanged: `local:<id>` vs raw federated oid.
- Admins invite by email (admin-only, outbound email required). Invitee sets credentials on first sign-in. Person may be linked, created, or omitted at invite time; the link is written immediately.
- Invite tokens are opaque (32-byte base64url, `sha256` stored). Not HMAC like [ADR-0014](0014-managed-admin-forced-reset-first-login.md) reset tokens — those are minted by familychart-admin with no tenant DB. Invite tokens are minted in-app; tying them to `NEXTAUTH_SECRET` would invalidate every pending invite on secret rotation.
- Entra first sign-in matches a live pending invite by normalised email, else auto-creates an `accounts` row. Entra **role still comes only from group membership**; `accounts.role` is inert for `auth_method=entra` and is hidden in the admin edit form.
- **Amended (v1.0.0):** the original migrations `016_local_users_must_reset_password` and `017_accounts_unification` are re-squashed into the boot baseline (`applyBaselineSchema()` in `lib/db.ts`). A fresh 1.0.0 install creates `accounts` and `people.account_uid` directly — it never creates `local_users` / `people.user_uid` and never runs 016/017. A database that already applied 016/017 keeps those `schema_migrations` rows; they are simply no longer in the runnable migration list. Any remaining `local_users` strings in TypeScript are historical (comments, changelog, this ADR) — not live queries.

## Consequences

- Existing self-hosted and managed databases upgrade in place; pre-existing rows are `status=active`, `auth_method=local`.
- `/admin/local-users` and `/api/local-users` remain as redirects / compatibility surfaces; the product UI is `/admin/accounts`.
- Request-scoped identity columns (`push_endpoints.user_uid`, `person_notification_prefs.user_uid`, `favourites.user_uid`, `user_app_state.user_uid`, `user_settings.user_uid`) are **not** renamed.
- Accepted gap: an Entra identity that has never signed in has no `accounts` row and cannot be pre-linked to a Person.
