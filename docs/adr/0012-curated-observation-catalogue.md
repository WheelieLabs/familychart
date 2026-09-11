# ADR-0012: Curated observation catalogue with instance-wide hide/show

**Status:** Accepted — v0.56.0

## Context

Managers could previously create freeform observation types and edit catalogue metadata (chart type, units, sort order, staleness, age caps) via `/management/observation-types`. That conflicted with the product decision that observation types are a **curated catalogue** shipped with the app (seeded in migrations; UI metadata in `OBSERVATION_UI_TYPES` / `lib/observation-types.ts`).

Related unit preference and display-layer conversion shipped separately.

## Decision

1. **Curated-only** — no manager create-type path. `POST /api/observation-type-config` returns 405. New types arrive only via catalogue seed/migration releases.
2. **Instance-wide hide/show** — `observation_type_config.is_active` is the sole visibility control. No per-person hide overlay.
3. **Toggle-only management UI** — managers may activate/deactivate rows; metadata is not editable via API or UI. `PATCH /api/observation-type-config/:id` accepts `is_active` only.
4. **Grandfather** — any pre-existing non-catalogue row that remains `is_active` stays recordable and toggleable (zero such rows in production at decision time). `validateObservationWrite` continues to require an active `observation_type_config` row (import and observation POST/PATCH).
5. **No hard delete** — `DELETE` soft-deactivates (`is_active = 0`) so seeded catalogue rows are not permanently removed from a tenant DB.

## Consequences

- Catalogue display defaults (units, charts, age caps) change only in app releases, not per tenant.
- README / architecture describe observation type management as active/inactive visibility over a fixed catalogue.
- Escape-hatch "Other" type and per-person hide remain out of scope.

## References

- Design decision: curated catalogue with hide/show
- `locale.measurement_system` setting
- Display-layer unit conversion
