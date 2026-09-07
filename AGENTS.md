# AGENTS.md

Instructions for AI coding assistants (Cursor, Claude Code, Copilot, etc.) working in this repository.

## Read first

1. [`CONTRIBUTING.md`](CONTRIBUTING.md) — dev commands, verification, doc sync
2. [`docs/architecture.md`](docs/architecture.md) — schema, auth, RBAC, patterns, cron/push
3. [`docs/adr/`](docs/adr/) — durable decisions (settings, setup gate, encryption, managed profile)
4. [`README.md`](README.md) — operator-facing features, env vars, roles (when changing user-visible behaviour)
5. `docs-internal/` — managed-hosting platform detail (provisioner, key server, agents) and ecosystem skills install/planning reports (`skills.md`). **Not part of the public export** (excluded via `public-export-manifest.json`, see [ADR-0013](docs/adr/0013-public-export-scope-manifest.md)) — only present when working in `familychart-dev`. Check it alongside `docs/adr/` when a decision touches `FC_PLATFORM_PROFILE=managed`, encryption keyserver mode, provisioning, or wave planning.

Cross-repo context: **familychart-skills** — see `docs-internal/skills.md`. Ecosystem references: `references/constraints.md`, `references/provisioning-decisions.md` (under `$FC_SKILLS_ROOT/familychart-ecosystem/`).

## Conventions

- Match naming and patterns in neighbouring code; see architecture doc for server/client split, API auth checks, and TypeScript types.
- Use British spelling in JSON API `error` strings where established (`Unauthorised`).
- Run `npm run test:run`, `npm run lint`, and `npm run build` (or `typecheck`) to verify non-trivial changes unless the task is docs-only.
- Update README and `.env.local.example` when env vars or operator-facing behaviour changes; update `docs/architecture.md` for schema or structural changes; add or supersede ADRs in `docs/adr/` for durable decisions.
- **Do not claim AI co-authorship.** Never add `Co-Authored-By`, `Made-with`, `Generated with`, or similar trailers/footers to commits or PRs. Commit as the human author only.
- **Do not write bare issue-number or cross-repo tracker references into code comments or docs** (`#NNN`, `other-repo#NNN`). Almost everything in this repo ships to the public mirror at v1.0.0+ ([ADR-0013](docs/adr/0013-public-export-scope-manifest.md)), and these references have needed repeated cleanup passes to scrub (`scripts/check-public-export-leaks.mjs` catches strays before release, but get it right the first time rather than relying on that net). Point at an ADR, a `CONTEXT.md` section, or plain prose describing the decision/behaviour instead of a tracker number.

## Boundaries

Unless the user explicitly requests otherwise:

- **Do not run:** `docker build`, `git push`, `npm version`
- **May run:** `npm run build`, `npm run lint`, `npm run typecheck`, `npm run test:run`; read-only git (`log`, `diff`, `status`)

Releases, version bumps, Docker builds, and pushes are handled by the maintainer.

## Maintainer workflow

- **Issue tracker:** [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md)
- **Triage labels:** [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md)
- **Domain docs:** [`docs/agents/domain.md`](docs/agents/domain.md)
- **Wave plan:** `Action Wave N from ~/.familychart/reports/waveplan.md` — see `docs-internal/skills.md`
- **Public-export cutover:** `docs-internal/public-export-release.md` — merge `public-main`, gate scripts, token provisioning. Pushing a `public/vN` tag is a maintainer step, never an agent step.
