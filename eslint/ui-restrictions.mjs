// Lint rules that keep the UI on the shared components (docs/architecture.md, UI components).
// They are `no-restricted-syntax` selectors so they sit in the existing flat config.

const CONTROLS = "button|input|select|textarea"
const TRANSLUCENT = String.raw`\b(?:text|bg)-white\/\d+`

const rawControls = {
  selector: `JSXOpeningElement[name.type='JSXIdentifier'][name.name=/^(${CONTROLS})$/]`,
  message:
    "Use the shared UI component instead of a raw <button>, <input>, <select> or <textarea>: Button, IconButton, EntityRowActions or a FormField control from components/ui. See docs/architecture.md > UI components.",
}

const displayDates = [
  {
    selector: "CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/]",
    message:
      "Do not format dates or numbers for display with toLocale*String (it follows the browser's locale). Use lib/date-format (formatDate, formatTime, formatDateTime, ...). See docs/architecture.md > UI components > Dates and times.",
  },
  {
    selector: "NewExpression[callee.object.name='Intl'][callee.property.name='DateTimeFormat']",
    message:
      "Do not build an Intl.DateTimeFormat for display. Use lib/date-format (formatDate, formatTime, formatDateTime, ...).",
  },
  {
    selector: "CallExpression[callee.object.name='Intl'][callee.property.name='DateTimeFormat']",
    message:
      "Do not build an Intl.DateTimeFormat for display. Use lib/date-format (formatDate, formatTime, formatDateTime, ...).",
  },
]

const translucent = [
  {
    selector: `Literal[value=/${TRANSLUCENT}/]`,
    message:
      "Translucent text-white/NN and bg-white/NN fail contrast. Use the solid tokens (text-text-on-brand, text-text-on-brand-muted, bg-surface-action, bg-surface-panel) or a shared Card or Banner. See docs/architecture.md > UI components > Colour tokens.",
  },
  {
    selector: `TemplateElement[value.raw=/${TRANSLUCENT}/]`,
    message:
      "Translucent text-white/NN and bg-white/NN fail contrast. Use the solid tokens (text-text-on-brand, text-text-on-brand-muted, bg-surface-action, bg-surface-panel) or a shared Card or Banner.",
  },
]

/** A `max-w-*` on the page's `main` or on its direct child. Page width belongs to PageContainer. */
const pageWidths = [
  "JSXElement[openingElement.name.name='main'] > JSXOpeningElement > JSXAttribute[name.name='className'] :matches(Literal, TemplateElement)",
  "JSXElement[openingElement.name.name='main'] > JSXElement > JSXOpeningElement > JSXAttribute[name.name='className'] :matches(Literal, TemplateElement)",
].flatMap(base => [
  {
    selector: `${base}[value=/\\bmax-w-/]`,
    message:
      "Do not set a page width by hand. PageContainer owns the page width (768px, full, or narrow). See docs/architecture.md > UI components.",
  },
  {
    selector: `${base}[value.raw=/\\bmax-w-/]`,
    message:
      "Do not set a page width by hand. PageContainer owns the page width (768px, full, or narrow).",
  },
])

/** Selectors for every source file the rules cover. */
export const uiRestrictions = [rawControls, ...displayDates, ...translucent]

/** Page files additionally get the width rule. */
export const uiRestrictionsForPages = [...uiRestrictions, ...pageWidths]

/** Where the rules apply. */
export const UI_RULE_FILES = ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"]
export const UI_RULE_PAGE_FILES = ["app/**/page.tsx", "app/**/layout.tsx"]

/** Never covered: the shared components, the formatter, and tests. */
export const UI_RULE_ALWAYS_IGNORED = [
  "components/ui/**",
  "lib/date-format.ts",
  "**/__tests__/**",
  "**/*.test.{ts,tsx}",
]
