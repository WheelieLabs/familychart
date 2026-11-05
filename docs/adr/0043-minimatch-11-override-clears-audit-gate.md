# ADR-0043: Override `minimatch` to 11 to clear the release audit gate

**Status:** Accepted (decided 2026-11-05) — supersedes [ADR-0018](0018-dev-only-lint-chain-audit-exception.md); remove each scoped override once its package declares `minimatch` 11

## Context

[ADR-0018](0018-dev-only-lint-chain-audit-exception.md) accepted the `braces` advisory (GHSA-vfj7-8cjw-p6xm) in the ESLint chain as a dev-only exception. That advisory was **withdrawn on 2026-10-23** and no longer appears in `npm audit`, so the exception has nothing left to cover.

A different advisory now fails the release gate. `npm audit --omit=dev` must report zero vulnerabilities (`CONTRIBUTING.md`), but on 1.1.4 it reported 3 moderate findings from one advisory: `minimatch` GHSA-g3hv-75wg-m249, a denial of service from crafted glob patterns, affecting `>=7.0.0 <11.0.1`. It reaches production through `archiver` 8 → `readdir-glob` 3 → `minimatch` 10.2.6. The full `npm audit` reported 19 moderate findings from the same advisory, also reached through the ESLint / typescript-eslint chain.

- No 10.x fix exists. The first patched version is 11.0.1.
- `npm audit fix --force` proposes major downgrades (eslint 9, archiver 7, eslint-config-next 15).
- The app only uses `ZipArchive` (`lib/export/export-zip-stream.ts`, `lib/restore/protected-zip.ts`) and never calls `.glob()` or `.directory()`, so the vulnerable path is not reachable. The gate still fails, and a gate with standing exceptions stops being a gate.

## Decision

- Override `minimatch` to `^11.0.1` in `package.json` `overrides`, scoped to the four packages that declare `^10`: `readdir-glob`, `eslint`, `@eslint/config-array` and `@typescript-eslint/typescript-estree`. This is a forced major: `minimatch` 11 rewrote the matcher on `@isaacs/nonrecursive-glob-match`, and none of them declares `^11` yet. It is the same author's own package, licensed Blue Oak 1.0.0, not a fork.
- Do not make the override global. `eslint-config-next` bundles `eslint-plugin-react`, `eslint-plugin-import` and `eslint-plugin-jsx-a11y`, which depend on `minimatch` ^3 and call it as a function (`minimatch(...)` or `.default(...)`). `minimatch` 11 exports neither, so those rules would throw once given glob options. `minimatch` 3.1.5 is outside the advisory's range and stays.
- After changing the override, check `package-lock.json` marks `minimatch` and its dependencies as production (no `"dev": true`). npm once flagged the overridden copy as dev-only, which would drop it from a `--omit=dev` install and break `archiver` at runtime. `THIRD-PARTY-NOTICES.md` listing `minimatch` is a quick tell.
- The release gate is unchanged: `npm audit --omit=dev` must report zero vulnerabilities. A full `npm audit` must also report zero. There is no standing exception.
- Verified by the export ZIP and protected-ZIP restore tests, and by `npm run lint` still resolving its file globs.
- Re-check on each dependency-update pass. Remove each scoped entry once that package declares `minimatch` ^11.

## Considered options

- **`npm audit fix --force`.** Rejected: downgrades eslint, archiver and eslint-config-next across majors.
- **Extend ADR-0018 with a second exception.** Rejected: the finding reaches the production dependency tree, so it fails the `--omit=dev` gate, which ADR-0018 never excused.
- **Replace `archiver`.** Rejected: disproportionate when an override to the upstream patched release clears it.
