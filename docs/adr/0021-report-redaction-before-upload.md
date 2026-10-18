# ADR-0021: Report attachments are redacted on the phone before they are stored

**Status:** Accepted (decided October 2026); implemented in 1.1.0

## Context

- A pathology report carries the patient's identifiers in its header: Medicare number, date of birth, home address, phone number and more. Test results and their attachments are new in 1.1.0, so nothing has shipped that stores them yet.
- The application needs the clinical content, not the identifiers. Stored files travel into shared household access, the person export, backups and screenshots of the viewer.
- ADR-0020 reads the text layer on the phone and treated the stored attachment as the source of truth. Rescan (reading a stored report again for missed values) depends on that layer surviving.
- The unredacted report must never reach the server, which is also why prefill runs on the phone.

## Decision

- **Every attachment is checked and redacted on the phone before upload.** A PDF, or a JPEG, PNG or WebP photo or scan, goes through a mandatory review step in Record Test Result. There is no switch to skip it; confirming "nothing to remove" is one tap.
- **True removal, not covering.** Boxes are painted into the page pixels before the page is encoded, so nothing boxed exists anywhere in the output. A black rectangle drawn over a PDF text layer would leave the text underneath extractable and is not used.
- **Output.** A PDF becomes a single PDF of redacted page images (200 dpi JPEG) plus an **invisible text layer** rebuilt from the original text items that do not touch any box (an item touching a box is dropped whole, never trimmed). The existing prefill extractor reads that layer unchanged, so rescan keeps working. A photo or scan is re-encoded as one JPEG with the boxes painted in (metadata dropped). The PDF is written with `pdfkit`, the writer already chosen for the planned Reports feature, loaded lazily in the browser.
- **The original is discarded.** Only the redacted file is stored. Prefill runs on the original before redaction, in the browser, as before.
- **Detection only suggests.** Boxed in advance: Medicare number (format and check digit), labelled date of birth, labelled address (and a following state-and-postcode line), phone numbers, email addresses and the individual healthcare identifier. Offered but not boxed: the patient name (so a stored report still says whose it is) and the request or accession number (how the laboratory finds a report). The requesting doctor's details are left alone. The carer reviews every page, can toggle any suggestion, and can draw a box by hand, which is the only route for a photo or scan.
- **Verified before use.** After assembly the file is re-read with pdf.js and its bytes scanned for every string a box removed; a leak, or a page-count mismatch, stops the attachment with an explanation. The scan decodes pdfkit's kerned hex text runs first, because a naive byte search misses even visible words and would pass a leak.
- **No retroactive tool** for attachments stored before this decision (they exist only on the maintainer's own pre-release instance).
- **Tests use synthetic fixtures only.** Real reports are never committed or attached to the tracker.

## Consequences

- ADR-0020's position that the attachment is the source of truth is amended: the stored file is a redacted copy, and the original is gone. Prefill and rescan still work because the text layer of the copy keeps what was not boxed.
- Rescan can lose a row whose text shared an item with a boxed identifier. It never gains one that was boxed.
- Detection is label and pattern based, so unlabelled names and addresses, and anything on a scan, depend on the carer's review. A missed identifier is a privacy failure, which is why the review is mandatory and the boxes can be drawn by hand.
- On a Pixel 8 (Chrome 154, installed app) a 10-page synthetic report took about 0.8 s to rasterise at 200 dpi with a flat heap and produced about 1.5 MB. A page is about 0.15 to 0.65 MB, so the 20 MB upload limit is not a constraint.
- Adds `pdfkit` (MIT) as a production dependency, about 206 KB gzipped in a lazily loaded chunk, and regenerates `THIRD-PARTY-NOTICES.md`.
- Stored reports are images, so the in-app viewer shows exactly what was approved.
