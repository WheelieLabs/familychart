import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8")

/** `--color-<name>` values declared in the `@theme` block of globals.css. */
function token(name: string): string {
  const match = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\b`))
  if (!match) throw new Error(`Token --color-${name} is not declared in globals.css`)
  return match[1].toLowerCase()
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** A colour is either a token name declared in globals.css or a literal hex. */
function resolve(colour: string): string {
  return colour.startsWith("#") ? colour.toLowerCase() : token(colour)
}

const WHITE = "#ffffff"
const TEXT = 4.5
const NON_TEXT = 3

type Pair = readonly [label: string, fg: string, bg: string, min: number]

// Every pair the UI components spec decides. Token names are read from globals.css; literal hex
// values are component-level states that the component tickets will introduce.
const pairs: readonly Pair[] = [
  // Body text
  ["text-primary on header", "text-primary", "surface-header", TEXT],
  ["text-primary on panel", "text-primary", "surface-panel", TEXT],
  ["text-primary on white", "text-primary", WHITE, TEXT],
  ["text-secondary on header", "text-secondary", "surface-header", TEXT],
  ["text-secondary on panel", "text-secondary", "surface-panel", TEXT],
  ["text-secondary on white", "text-secondary", WHITE, TEXT],
  ["text-brand on panel", "text-brand", "surface-panel", TEXT],
  ["text-brand on white", "text-brand", WHITE, TEXT],
  ["text-on-brand on app canvas", "text-on-brand", "surface-app", TEXT],
  ["text-on-brand on card", "text-on-brand", "surface-action", TEXT],
  ["text-on-brand on admin canvas", "text-on-brand", "surface-admin", TEXT],
  ["text-on-brand-muted on app canvas", "text-on-brand-muted", "surface-app", TEXT],
  ["text-on-brand-muted on card", "text-on-brand-muted", "surface-action", TEXT],
  ["text-on-brand-muted on admin canvas", "text-on-brand-muted", "surface-admin", TEXT],

  // Status text. Error-on-brand is for cards and the admin canvas only: it is 3.92 on the app canvas.
  ["error text on brand, card", "status-error-text-on-brand", "surface-action", TEXT],
  ["error text on brand, admin canvas", "status-error-text-on-brand", "surface-admin", TEXT],
  ["error text on panel", "status-error-text", "surface-panel", TEXT],
  ["error text on white", "status-error-text", WHITE, TEXT],
  ["success text on panel", "status-success-text", "surface-panel", TEXT],
  ["success text on white", "status-success-text", WHITE, TEXT],
  ["warning text on panel", "status-warning-text", "surface-panel", TEXT],
  ["warning text on white", "status-warning-text", WHITE, TEXT],

  // Badges
  ["warning badge", "badge-warning-fg", "badge-warning-bg", TEXT],
  ["success badge", "badge-success-fg", "badge-success-bg", TEXT],
  ["neutral badge", "badge-neutral-fg", "badge-neutral-bg", TEXT],
  ["info badge", "badge-info-fg", "badge-info-bg", TEXT],
  ["error badge", "badge-error-fg", "badge-error-bg", TEXT],

  // Disabled controls
  ["disabled text, light fill", "disabled-fg", "disabled-bg", TEXT],
  ["disabled text on dark, app canvas", "disabled-fg-on-brand", "surface-app", TEXT],
  ["disabled text on dark, card", "disabled-fg-on-brand", "surface-action", TEXT],
  ["disabled text on dark, admin canvas", "disabled-fg-on-brand", "surface-admin", TEXT],

  // Focus ring and control borders (non-text)
  ["focus ring on panel", "focus-ring", "surface-panel", NON_TEXT],
  ["focus ring on header", "focus-ring", "surface-header", NON_TEXT],
  ["focus ring on white", "focus-ring", WHITE, NON_TEXT],
  ["focus ring on brand, app canvas", "focus-ring-on-brand", "surface-app", NON_TEXT],
  ["focus ring on brand, card", "focus-ring-on-brand", "surface-action", NON_TEXT],
  ["focus ring on brand, admin canvas", "focus-ring-on-brand", "surface-admin", NON_TEXT],
  ["control border on panel", "text-secondary", "surface-panel", NON_TEXT],
  ["control border on white", "text-secondary", WHITE, NON_TEXT],
  ["error border on panel", "status-error-text", "surface-panel", NON_TEXT],
  ["placeholder on white", "#5f6b7a", WHITE, TEXT],

  // Button states, dark surfaces
  ["primary dark", "text-brand", WHITE, TEXT],
  ["primary dark hover", "text-brand", "text-on-brand-muted", TEXT],
  ["primary dark pressed", "surface-action", "#cfe0ef", TEXT],
  ["secondary dark hover on canvas", WHITE, "surface-admin", TEXT],
  ["secondary dark hover on admin", WHITE, "surface-action", TEXT],
  ["secondary dark pressed", WHITE, "#0f4468", TEXT],
  ["destructive dark", "status-error-text-on-brand", "surface-action", TEXT],
  ["destructive dark hover", "status-error-text-on-brand", "surface-admin", TEXT],
  ["destructive dark pressed", "status-error-text-on-brand", "#0f4468", TEXT],

  // Button states, light surfaces
  ["primary light", WHITE, "surface-app", TEXT],
  ["primary light hover", WHITE, "surface-action", TEXT],
  ["primary light pressed", WHITE, "surface-admin", TEXT],
  ["secondary light", "text-brand", "surface-panel", TEXT],
  ["secondary light hover", "text-brand", "#eaf3fa", TEXT],
  ["secondary light pressed", "surface-action", "#cfe0ef", TEXT],
  ["destructive light", "status-error-text", "surface-panel", TEXT],
  ["destructive light hover", "status-error-text", "#fee2e2", TEXT],
  ["destructive light pressed", "#991b1b", "#fecaca", TEXT],

  // Chips
  ["chip dark unselected", WHITE, "surface-app", TEXT],
  ["chip dark unselected border", "text-on-brand-muted", "surface-app", NON_TEXT],
  ["chip dark selected", WHITE, "surface-admin", TEXT],
  ["chip dark selected hover", WHITE, "#0f4468", TEXT],
  ["chip light unselected", "text-primary", WHITE, TEXT],
  ["chip light unselected hover", "text-primary", "#eaf3fa", TEXT],
  ["chip light selected", WHITE, "surface-app", TEXT],
  ["chip light selected hover", WHITE, "surface-action", TEXT],

  // Banners
  ["info banner", "text-primary", "surface-panel", TEXT],
  ["warning banner", "#92400e", "#fffbeb", TEXT],
  ["error banner", "#991b1b", "#fef2f2", TEXT],
  ["success banner", "#166534", "#f0fdf4", TEXT],

  // Privacy cover (globals.css): a deliberate exception to the translucent-colour rules.
  ["privacy cover", WHITE, "surface-action", TEXT],
]

describe("ui colour tokens", () => {
  it.each(pairs)("%s meets its contrast ratio", (_label, fg, bg, min) => {
    expect(ratio(resolve(fg), resolve(bg))).toBeGreaterThanOrEqual(min)
  })

  it("keeps the spec's token values", () => {
    expect({
      "surface-app": token("surface-app"),
      "surface-admin": token("surface-admin"),
      "surface-header": token("surface-header"),
      "surface-panel": token("surface-panel"),
      "surface-action": token("surface-action"),
      "text-primary": token("text-primary"),
      "text-secondary": token("text-secondary"),
      "text-brand": token("text-brand"),
      "text-on-brand": token("text-on-brand"),
      "text-on-brand-muted": token("text-on-brand-muted"),
      "status-error-text-on-brand": token("status-error-text-on-brand"),
      "status-error-text": token("status-error-text"),
      "status-success-text": token("status-success-text"),
      "status-warning-text": token("status-warning-text"),
    }).toEqual({
      "surface-app": "#256aa5",
      "surface-admin": "#124f7a",
      "surface-header": "#c8ddef",
      "surface-panel": "#d8e9f5",
      "surface-action": "#1a5f96",
      "text-primary": "#1e2939",
      "text-secondary": "#4a5565",
      "text-brand": "#256aa5",
      "text-on-brand": "#ffffff",
      "text-on-brand-muted": "#e0ecf6",
      "status-error-text-on-brand": "#ffc9c9",
      "status-error-text": "#b91c1c",
      "status-success-text": "#166534",
      "status-warning-text": "#92400e",
    })
  })

  it("keeps the privacy cover colours the contrast table assumes", () => {
    expect(css).toMatch(/background:\s*#1a5f96/i)
    expect(css).toMatch(/html\[data-fc-cover="1"\]::after[\s\S]*?color:\s*#fff;/)
  })
})
