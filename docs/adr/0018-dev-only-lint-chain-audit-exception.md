# ADR-0018: Accept the dev-only `braces` advisory in the ESLint chain

**Status:** Accepted (decided 2026-10-04); revisit when upstream ships a fix

## Context

`npm audit` reports five high-severity findings, all one dependency chain: `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces`. The advisory is a stack-exhaustion denial of service on deeply nested glob patterns and covers every published `braces` release (`<=3.0.3`, last published September 2024). No patched version exists, and the newest `micromatch` and `fast-glob` releases still depend on it. `@next/eslint-plugin-next` pins `fast-glob` 3.3.1 even on the 16.4 canary line, so waiting for a Next.js bump will not clear it.

The only fix npm offers is `npm audit fix --force`, which downgrades `eslint-config-next` to 14.2.35. That is incompatible with Next 16 and ESLint 10, so it is not an option.

The chain is lint tooling. `npm audit --omit=dev` reports no vulnerabilities, and the packages are not in the production image. Triggering the advisory needs deeply nested glob patterns, and here the patterns come from the lint plugin's own static configuration, not from user input.

## Decision

- Accept the five findings as a documented exception. Do not use `npm audit fix --force`, and do not add an `overrides` entry that swaps `braces` for an unvetted fork.
- The dependency-audit gate for releases is `npm audit --omit=dev`, which must report zero vulnerabilities. A full `npm audit` is still run, and any finding outside this chain is actioned normally.
- Re-check on each dependency-update pass. The exception ends, and this ADR is superseded, as soon as `braces` publishes a patched release or `fast-glob` / `eslint-config-next` stop depending on it.
- The upstream state is tracked on the issue tracker as a deferred dependency.

## Considered options

- **`npm audit fix --force`.** Rejected: downgrades `eslint-config-next` across two majors.
- **`overrides` to a fork or alias of `braces`.** Rejected: clears the audit but adds an unvetted package to the supply chain, to silence a finding in tooling that never ships.
- **Replace `eslint-config-next`.** Rejected: disproportionate for a lint-only advisory.
