# ADR-0020: Text-layer PDF prefill runs on the phone, with self-hosted pdf.js

**Status:** Accepted (decided 2026-10-04)

## Context

Record Test Result asks a carer to retype headline values from the attached report, switching between apps. Reports usually arrive as PDFs, most with an embedded text layer. Values are health data, so where the file is read and what reads it matters: no third-party service should see a report.

## Decision

- **Scope is the text layer only.** No OCR for photos or scans, and no AI. A PDF with no text layer, or one yielding no recognised rows, shows no banner; the manual form is the baseline.
- **It runs on the phone.** pdf.js reads text positions in the browser; the report is not sent anywhere for parsing. pdf.js and its worker are served from the app's own origin (`public/pdfjs`, copied from `node_modules` by `scripts/copy-pdfjs-assets.mjs` on `predev`/`prebuild`, not committed), with no CDN and no blob worker. The standard font files are served alongside, because reports that do not embed their fonts otherwise render with ragged spacing in the source strip.
- **Suggestions, never facts.** Extraction is rule-based over text items with positions (`lib/test-results/pdf-prefill/`), covering single-line tables with bracketed or parenthesised ranges, inline multi-analyte lines, date-and-request-number grids with the metric as a column header, and units that appear only in a header line. Footers, patient and laboratory furniture, and interpretation or guideline prose are ignored. Nothing is pre-accepted: each suggestion shows the line it came from (tap to enlarge) with Correct, Edit and Skip. The strip is never saved; the attachment stays the source of truth.
- **Matching is exact name or alias, never a substring**, using the catalogue of ADR-0019. Where more than one entry fits (HbA1c in two units, a bare "Glucose"), the unit the report prints decides if it can, and otherwise the carer chooses in the Edit step.
- **What it fills:** metric, value, limit qualifier, unit and reference range, plus a collection date and report title offered as suggestions for the Test date and Name. The reference range is transcribed from the report, never derived.

## Consequences

- Adds `pdfjs-dist` (Apache-2.0) as a production dependency and regenerates `THIRD-PARTY-NOTICES.md`. Its optional Node-only canvas packages appear in the lockfile.
- The extraction rules were validated here on synthetic layouts and a generated PDF only; the earlier spike on real reports (two laboratories, one patient) is indicative. Real reports are never committed. Rules should be re-checked against new laboratories as they are met, and unrecognised layouts simply yield fewer suggestions.
- The rules have since been checked against real SA Pathology reports (ten single-page PDFs, all with a text layer, so OCR was not needed). That exposed an unrecognised "Reference Units" column header that left every row skipped, footnote markers read as the range, percentage rows matching count metrics, and a name wrapped across two lines; each is fixed and covered by synthetic fixtures. Photos and scans remain out of scope.
- Reading happens on the device, so very large PDFs cost the phone, not the server.

## Amendment: the stored attachment is a redacted copy

The attachment is no longer the unmodified report. Every attachment is redacted on the phone before upload ([ADR-0021](0021-report-redaction-before-upload.md)): the stored file is a copy with personal details removed, the original is not kept, and prefill still runs on the original in the browser before redaction. The copy keeps an invisible text layer for what was not boxed, so rescan works unchanged.
