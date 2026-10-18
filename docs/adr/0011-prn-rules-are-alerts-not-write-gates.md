# ADR-0011: PRN cooldown and 24h caps are alerts, not dose-write gates

**Status:** Accepted — v0.52.0 (won't-fix)

## Context

Security audit run 7 reported that PRN `min_hours_between` and `max_quantity_per_24h` are enforced only in the Record Medication UI warnings, not on `POST /api/records`. The finding proposed rejecting writes with HTTP 409 when `evaluatePrnState` would set `!canDose` or a projected 24h total would exceed the cap (and applying the same gate to spreadsheet import).

FamilyChart is a **record-keeping** application for households documenting doses that were given. It does not provide clinical advice and must not prevent caregivers from recording what actually happened — including doses that fall inside a configured cooldown or above a configured 24h total. Frequency rules exist so the dashboard, person alerts, and push reminders can surface caregiver-facing status (`prn_cooldown`, `prn_at_cap`, coverage gap, PRN remind-after). Field validation on the write path (added afterward) still bounds dosage, units, and timestamps so those **alerts stay accurate**; that is integrity of observation data, not a dosing gate.

## Decision

**Won’t-fix hard rejection** for cooldown or 24h caps on any medication-record write path:

- `POST` / `PATCH` `/api/records`
- Spreadsheet import confirm (when it creates medication records)

`loadMedicationDoseState` / `evaluatePrnState` (including the `canDose` flag) remain for Alert readiness, Record Medication UI status, and related surfaces only. `canDose` means “interval and cap clear for alert purposes,” not “permission to write.”

UI warnings on Record Medication stay informational; Save remains available (no soft override gate in this ADR).

## Consequences

- Auditors following `canDose` must not expect API enforcement — see comments on the records write seam, `validateMedicationRecordWrite`, and `evaluatePrnState`.
- README documents that frequency rules drive alerts and reminders, not write rejection.
- Cron PRN readiness must use the same `evaluatePrnState` result as dashboard/UI (`!cooldown`, still skip when `atCap`) — no parallel interval predicate.
- Reopening the write-gate approach would reverse this product decision and should require a new ADR.

## References

- Security audit finding and product won't-fix disposition
- Dose-write field validation (alert-accuracy bounds)
- Group frequency rules deliberately not enforced — see `getApplicableFrequencyRule` docs

## Amendment: a once-a-day maximum is not a cap alert for a scheduled medication (October 2026)

**Status:** Accepted; implemented in 1.1.0.

A scheduled medication whose 24-hour maximum allows only one dose a day (a count of 1, or a quantity of one dose unit) reached "at 24h max" the moment its scheduled dose was given, which is the expected dose and not something to alert on, and the cap then held back tomorrow's earlier reminder. This does not make the cap a write gate; it narrows when the alert fires.

- **Decision.** For a scheduled medication, a maximum that allows one dose a day raises no "at 24h max" alert and does not hold back its next scheduled reminder. A PRN medication, a scheduled medication that allows two or more doses a day, and an ended or inactive schedule keep the alert.
- **One decision for every reader.** The dashboard alert, reminder blocking and the medication timeline read the same result, so the timeline's "24h cap" flag and striped band show exactly when the dashboard says "at 24h max", and a scheduled lane keeps no next-eligible marker (its slots are its next doses). Bands are drawn only within the visible timeline.
- **Unchanged.** Nothing is rejected at write time, and Cron PRN readiness still uses the one `evaluatePrnState` result.
