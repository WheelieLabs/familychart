# ADR-0019: Test metric catalogue — curated, alias-bearing, typed, with limit qualifiers

**Status:** Accepted (decided 2026-10-04); implemented on `release/v1.1.0` (migration `023_test_metric_catalogue`)

## Context

Record Test Result keeps a catalogue of test metrics (`test_metric_config`) that structured values are chosen from. It shipped with ten metrics, one default unit each, and nothing else. A typical GP first-pass request (full blood count, urea and electrolytes, liver, lipids, thyroid, iron studies, B12 and folate, HbA1c and glucose, vitamin D, CRP) mostly falls outside those ten, so almost every value becomes an "Other" row. Real laboratory reports also print abbreviated names ("Pot.", "Creat."), regional name variants (urea versus BUN), and values that are only a bound ("< 20", "> 90").

The catalogue mirrors the curated observation catalogue (ADR-0012), and results store the metric as text rather than a link to a catalogue row.

## Decision

- **Stays curated and release-shipped.** There is no manager or per-instance path to add metrics. New metrics, including specialist ones, arrive with a release seed. "Other" (a free-text metric name) remains the escape hatch, and the picker suggests free-text names previously used on that Person so a repeated specialist test is not retyped. A per-instance catalogue would drift between instances and weaken name and alias matching.
- **First pass is the numeric metrics of a typical GP request** (about 45, across the panels above). Specialist tests and qualitative urine dipstick results are later. Units that could not be verified from a primary source are confirmed when the seed list is written.
- **One default unit per metric, editable per result, no conversion.** The default is the SI unit commonly printed by the laboratories in use. The unit is already stored with each result, so a result in another unit is entered by editing it. HbA1c, which is genuinely reported in two units, has two catalogue entries, one per unit. The app never converts between units and never derives a reference range or severity.
- **One regime, aliases for the rest.** Canonical names and default units follow one SI regime. US names and abbreviations are aliases (BUN, uric acid, phosphorus). There is no regional switch, and the lab-unit regime is deliberately not tied to the metric/imperial measurement-system setting, which is a different axis.
- **Aliases and a Panel label ship with each metric.** Aliases serve search and report matching. Panel is a label for telling similar metrics apart (calcium appears in more than one panel), not navigation and not a fixed definition of what a laboratory reports.
- **The catalogue carries each metric's value type** (numeric, or qualitative for the rapid tests). The numeric/qualitative choice is shown only for "Other", where the app cannot know.
- **Existing names are not renamed.** Because results store the metric name as text, renaming a catalogue row would orphan existing results without a data migration. "Glucose (fasting)" stays and "Glucose (random)" is added; a bare "Glucose" on a report is resolved by the user, not guessed.
- **Limit values keep their qualifier.** A numeric result may carry an optional limit qualifier (`<`, `<=`, `>`, `>=`) stored beside the number, so "< 20" is the number 20 with qualifier `<`. The existing "differs from expected" flag stays separate.
- **Metric selection is a type-and-search control**, matching Record Medication, with "Other (type a name)" always last.

## Consequences

- Schema grows additively: alias data, a Panel label and a value type per metric, and a nullable qualifier on result values. Existing rows remain valid.
- Prefill from a PDF's text layer depends on this catalogue; with only the original ten metrics, about one row in ten matched on real reports.
- Values in different units (or HbA1c in its two forms) are not comparable without a conversion the app deliberately does not provide. Trends across such results, if ever added, must account for that.
- Adding a second unit regime later (for example US conventional units) can be done without changing canonical names, as a setting layered over aliases and editable units.
- Real SA Pathology reports added five analytes (Mean Platelet Volume, Anion Gap, Ionised Calcium, Globulin, Lactate Dehydrogenase) and a few aliases, shipped by a re-sync migration like the first pass. Differential percentage rows are deliberately not catalogued: a row whose unit is a percentage never matches a count metric, and the carer enters it by hand if wanted.
- This extends the curated-catalogue model of ADR-0012 to test metrics; it does not supersede it.
