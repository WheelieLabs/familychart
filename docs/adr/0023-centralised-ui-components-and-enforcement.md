# ADR-0023: Centralised UI components, tokens and lint enforcement

**Status:** Accepted

## Context

An audit of the app found the same job done many different ways (hundreds of button-like elements in nearly two hundred style combinations, several empty-state styles, three page-width caps, dates in three locales) and many of those ways failing WCAG 2.2 AA (translucent text on translucent cards, unlabelled form controls). Nothing stopped it drifting again: there were no shared definitions and no enforcement.

## Decision

- One small set of shared UI components and colour tokens, defined in `components/ui/` and `app/globals.css` and documented with exact values in `docs/architecture.md` under "UI components". Tokens use the names of the 1.2.0 theming work so its Classic mapping adopts these values.
- `Surface` declares a region dark or light and controls read it through CSS, so they take no tone prop.
- One display formatter, `lib/date-format.ts`, with a constant `en-AU` locale; the browser's locale is never used for display.
- Four ESLint rules, as `no-restricted-syntax` selectors in the existing flat config (`eslint/ui-restrictions.mjs`): raw `<button>`, `<input>`, `<select>` and `<textarea>`; `toLocale*String` and `Intl.DateTimeFormat` for display; translucent `text-white/NN` and `bg-white/NN` classes; and a hand-rolled `max-w-*` on a page's `main` or its direct child. Each message names the shared replacement. The shared components, the formatter and tests are never covered.
- During the migration a legacy-files exemption list (`eslint/legacy-ui-files.json`) covered every file that offended when the rules landed. It was deleted with the last migration (1.1.x); exceptions now take a targeted `eslint-disable-next-line` with a reason.
- Structure is standardised across the user, management and admin Areas; visual identity is not.

## Consequences

- A new file that hand-rolls a control, date format or translucent colour fails `npm run lint`; the message says what to use.
- The page-width rule is an approximation (the `main` element and its direct child); modals keep their own widths.
- Contributors and agents must use the shared components; `AGENTS.md` carries the rule.

## Addendum (1.1.x)

The legacy-files list was deleted once the last screen migrated. Import Records is the single deliberate exception: it carries a file-level `eslint-disable` until the 1.2.0 desktop layouts restyle it. Any other exception takes a targeted `eslint-disable-next-line` with a reason.
