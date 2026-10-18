// Tall viewports, so the page scrolls inside the app shell as little as possible. A control that
// happens to sit half under the footer at one window height would otherwise fail "target-size"
// for a reason that has nothing to do with the control.
export const VIEWPORTS = [
  { name: "phone", width: 390, height: 2400 },
  { name: "desktop", width: 1280, height: 1800 },
]

// WCAG 2.2 AA, including real colour contrast.
export const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]
