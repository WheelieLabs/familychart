# ADR-0024: Target sizes follow WCAG 2.2 AA, with 44px kept for primary controls

**Status:** Accepted

## Context

After the shared UI migration, History cards were tall: Edit and Delete at Default height (44px on touch), 44px link targets and 12px padding and gaps. The conformance target is WCAG 2.2 AA ([ADR-0023](0023-centralised-ui-components-and-enforcement.md)). AA asks for a 24px minimum target (2.5.8); the 44px size is the Level AAA recommendation (2.5.5). Card padding, gaps and row height have no WCAG requirement at any level. Dropping to Level A was considered and rejected: it would remove nothing that limits density and would give up the contrast, focus and reflow criteria the app was fixed against.

## Decision

- List-card density is tighter: `8px 10px` padding, 6px between cards, a 22px icon, no gap between the title, meta and extras lines.
- Secondary controls inside list rows use the 24px AA floor with margin: Edit and Delete are 32px (the `compact` look) on every pointer, and card links and summary rows are 24px minimum height. Suggestion list items drop their extra touch height.
- Primary and frequent controls keep 44px on touch: Default buttons (Save, Cancel, the Management bar), form controls, Checkbox and Toggle rows, the severity slider and the header icon buttons.
- Contrast (4.5:1 text, 3:1 non-text), visible focus and wrapping titles are AA criteria and do not change.

## Consequences

- History shows noticeably more records per screen; every `ListCard` screen shares the change.
- Touch targets on rows are smaller than the AAA size. If feedback shows mis-taps on Edit and Delete, raise `.fc-entity-actions .fc-btn` back to Default height; no component code changes.
