# Contributing

Thanks for helping with FamilyChart. This file covers local development, verification, and documentation expectations.

**Architecture and patterns:** [`docs/architecture.md`](docs/architecture.md)  
**Setup, features, and env vars (operators):** [`README.md`](README.md)  
**AI assistants:** [`AGENTS.md`](AGENTS.md)

---

## Prerequisites

- Node.js 24+ and npm
- Copy [`.env.local.example`](.env.local.example) to `.env.local` and fill in values (see README)

---

## Development commands

```bash
npm install
npm run dev       # http://localhost:4000 (webpack — see native module note below)
npm run dev:clean # after Node upgrade or stale .next cache
npm run typecheck # TypeScript only
npm run build     # production build
npm run lint      # ESLint
npm run test:run  # Vitest — non-interactive (watch: npm run test)
```

When you add or upgrade **production dependencies**, regenerate third-party licence notices:

```bash
node scripts/generate-third-party-notices.mjs
```

If a batch of new `app/`, `components/`, or `lib/` files ever lands without the `SPDX-License-Identifier` header, `node scripts/add-spdx-headers.mjs` adds it to every first-party source missing one (skips `__tests__`). One-off tool, not run routinely.

**Tests:** `lib/__tests__/` — cron predicates, dashboard status, frequency rules, permissions, schedules, and related behaviour. Run `npm run test:run` alongside build and lint before opening a PR.

> **Native module note:** `better-sqlite3` is a native addon. Local dev uses webpack (`npm run dev`) because Next.js 16 Turbopack cannot load it reliably in dev. `postinstall` runs `npm rebuild better-sqlite3` so the binary matches your Node version. If you still see `Module did not self-register`, run `npm run dev:clean` (clears `.next` and rebuilds the addon). Install and run from the same environment (e.g. WSL only — not Windows `npm install` + WSL `npm run dev`).

---

## Fresh checkout or worktree first run

`data/` (the SQLite DB) and `.env.local` are gitignored, so **every** `git worktree add` — not just your first-ever clone — starts with neither. This bites prototype worktrees (see the `/prototype` skill) as much as a first clone, since each worktree gets its own untracked state. Expect this sequence:

1. **`.env.local` is required, not optional, even for a throwaway prototype.** Copy `.env.local.example` → `.env.local` and set a real `NEXTAUTH_SECRET` (e.g. `openssl rand -base64 32`) before running `npm run dev`. Skipping this doesn't fail loudly at startup — `next-auth` throws `MissingSecret` lazily, on the first sign-in, which in practice means partway through the setup wizard.
2. If you added or changed `NEXTAUTH_SECRET` **after** already interacting with a running server (e.g. you hit `MissingSecret` mid-setup, then fixed it and restarted), any session cookie the browser already holds was signed under the old/missing secret and is now invalid — expect a stray `Unauthorised` on the next setup step even though the fix worked. Sign out and back in first.
3. If that still doesn't clear it — e.g. the setup wizard's admin-account step ran partway through before the secret was fixed — the DB can be left in an inconsistent setup state. Delete it and start the wizard clean: `rm -f data/familychart.db*` (each worktree's `data/` is independent, so this only affects that worktree). `npm run predev` regenerates `lib/changelog.generated.json` automatically on `npm run dev`, so no separate step is needed for that.

---

## Documentation map

| Document | Audience | Purpose |
|---|---|---|
| [`README.md`](README.md) | Operators and new contributors | Features, setup, env vars, roles, deployment |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contributors | Dev workflow (this file) |
| [`docs/architecture.md`](docs/architecture.md) | Contributors | Schema, auth, patterns, project layout |
| [`docs/adr/`](docs/adr/) | Contributors | Architecture decision records |
| [`.env.local.example`](.env.local.example) | Operators | Commented env template |
| [`CHANGELOG.md`](CHANGELOG.md) | Maintainers | Technical release notes (Keep a Changelog) |
| [`WHATS_NEW.md`](WHATS_NEW.md) | Maintainers | User-facing notes for the in-app What's New screen |
| [`docs/agents/`](docs/agents/) | Maintainers / agents | Issue tracker, triage, skills install |

### Keeping docs in sync

Update in the **same change** when you:

- Change **user-facing behaviour**, auth, roles, or deployment → `README.md`
- Add, rename, or remove an **environment variable** → `README.md`, [`.env.local.example`](.env.local.example), and [`docs/architecture.md`](docs/architecture.md) env table
- Change **schema**, API patterns, permissions, or project structure → [`docs/architecture.md`](docs/architecture.md)
- Make a **durable architectural decision** → add or update an ADR in [`docs/adr/`](docs/adr/)
- Change **dev commands** or verification expectations → this file
- Ship a **user-visible feature or fix** users should discover → [`WHATS_NEW.md`](WHATS_NEW.md) (in-app modal); technical detail still goes in [`CHANGELOG.md`](CHANGELOG.md)

Do not duplicate deep architecture in README — link to `docs/architecture.md` instead.

---

## Code conventions

Follow existing patterns in the area you are editing. Summary (full detail in [`docs/architecture.md`](docs/architecture.md)):

- **Server components** fetch via `getDb()`; **client components** call `/api/*` only
- **Route params** are a `Promise` in Next.js 16 — always `await params` in server pages/layouts
- **British spelling** in JSON API errors where established (`Unauthorised`)
- **Soft deletes** — use `is_active`; do not hard-delete production people or medications
- **Types** — row shapes in `lib/domain-types.ts`; client code uses `import type`

---

## Licence and Contributor Licence Agreement

FamilyChart is licensed under the [GNU Affero General Public License v3.0](LICENSE).

When external contributions are accepted, each contribution must also be covered by the [Contributor Licence Agreement](CLA.md). The CLA grants Benjamin Horder (trading as WheelieLabs) a perpetual licence to use your contribution under AGPL-3.0 and an explicit relicensing right for separate commercial offerings.

**Outside pull requests are not being merged yet.** The CLA policy and automation are in place on the public repository so the gate is ready when contributions open. Until then, please use [bug reports](.github/ISSUE_TEMPLATE/bug_report.md) for problems and [SECURITY.md](SECURITY.md) for security issues.
