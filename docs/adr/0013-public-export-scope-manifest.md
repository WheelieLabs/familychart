# ADR-0013: Public-export scope manifest

**Status:** Accepted (2026-08-03)

## Context

`familychart-dev` is going public as `WheelieLabs/familychart` at v1.0.0. It's a private, Free-plan GitHub repo, so classic branch protection (required PR status checks) isn't available — confirmed via `gh api repos/WheelieLabs/familychart-dev/branches/main/protection` returning `403 Upgrade to GitHub Pro or make this repository public`. A 2026-07-03 audit found no proprietary code co-located in this repo today (admin/agent/keyserver logic lives in separate repos), but that's a snapshot, not a standing guarantee — a future PR could add something that shouldn't ship publicly with no automated check to catch it.

## Decision

1. **Allowlist manifest** — `public-export-manifest.json` at repo root classifies every top-level path as `"public"` or `{ "status": "excluded", "label": "..." }`. Granularity is top-level only; the label on an excluded entry is terse ("internal/proprietary — not exported") and never describes contents.
2. **Fail-loud CI checks** — `scripts/check-public-export-manifest.mjs` diffs the actual top-level git tree against the manifest and exits non-zero on any unclassified path. `scripts/check-public-export-leaks.mjs` scans git-tracked files under `"public"` paths and exits non-zero on bare issue-number or cross-repo tracker references.
3. **Gated at sync time, not PR time** — both checks run as the first steps of the `public/vN`-tag-triggered sync workflow that mirrors `public-main` to `WheelieLabs/familychart:main`; a failure aborts the sync before anything is pushed publicly. After the gates pass, `scripts/prepare-public-export-tree.mjs` deletes excluded top-level paths from the working tree so the orphan commit does not publish them. This is a hard technical gate on the one event that actually matters (crossing into public), and it doesn't depend on a paid-plan-only GitHub feature. A PR-time run of the same scripts on `public-main` can give early feedback but is advisory only, never required.

## Consequences

- Adding a new top-level file or directory to the repo doesn't silently become publicly exported — the sync workflow refuses to run until it's classified.
- The manifest and check are mechanism only; they don't dictate what gets excluded — that's a per-path editorial call.
- If GitHub Pro (or making the repo public pre-v1) becomes viable later, a required PR status check could supersede the sync-time gate — out of scope here.

## Amendment (2026-08-03)

`docs-internal/` was added and classified `excluded` — the first real use of this mechanism. It holds managed-hosting-platform detail (provisioner, key-server, and agent env vars; infra topology; billing-flow mechanics) that was previously written directly into `docs/adr/0002`, `0003`, `0004`, and `0006`. Those ADRs were redacted in the same pass: they still acknowledge that a managed-hosting platform exists and describe this app's own side of the integration, but no longer document other repos' internals — see `docs-internal/managed-hosting.md` and its `README.md` for the redaction convention going forward.

## Amendment (2026-09-04)

Classification alone does not keep excluded paths off the public remote: the sync workflow historically committed the whole working tree (`git add -A`) after the manifest check. `docs-internal/` was therefore safe only while it was absent from `public-main`. Bringing that branch current with the release line would have published it. The sync workflow now strips excluded paths before the orphan commit, and also runs the content leak check so issue-number / cross-repo tracker references cannot ride along in `"public"` files. Maintainer cutover steps (including token provisioning) live in `docs-internal/public-export-release.md`.

## Amendment (2026-09-11)

Added a third manifest status, `{ "status": "excluded-scanned", "label": "..." }`: stripped from the export tree like `excluded`, but still scanned by `check-public-export-leaks.mjs`. Needed for paths whose *content* reaches the public repo by a route other than being committed as a file — first use is `.github/public-release-message.txt`, an optional maintainer-written file whose content becomes the public orphan commit's message (see `public-export-sync.yml` and `docs-internal/public-export-release.md`). A plain `excluded` entry would have let unreviewed text ride along in that commit message with no leak check at all.

## References

- No automated safeguard previously existed against admin/agent/keyserver code entering the public export
- This ADR's own manifest + CI gates + excluded-path strip
- The tag-triggered sync workflow that runs those steps
- Maintainer runbook (not exported): `docs-internal/public-export-release.md`
