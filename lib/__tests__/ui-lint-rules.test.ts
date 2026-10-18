import { join } from "node:path"
import { ESLint } from "eslint"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const eslint = new ESLint({ cwd: root, overrideConfigFile: join(root, "eslint.config.mjs") })

async function lint(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(root, filePath) })
  return result.messages.filter(m => m.ruleId === "no-restricted-syntax").map(m => m.message)
}

// A path that is covered by the rules.
const COVERED = "components/NewThing.tsx"
const PAGE = "app/newpage/page.tsx"

// The first lintText call boots ESLint with the full project config, which can take
// about 5s when the whole suite runs in parallel, so the 5s default is too tight.
describe("UI lint rules", { timeout: 30_000 }, () => {
  describe("raw controls", () => {
    it.each(["button", "input", "select", "textarea"])("flags a raw <%s>", async tag => {
      const messages = await lint(`export const A = () => <${tag} />\n`, COVERED)
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatch(/shared UI component/)
    })

    it("passes in the shared components", async () => {
      expect(await lint(`export const A = () => <button type="button" />\n`, "components/ui/Button.tsx")).toEqual([])
    })

    it("passes on a shared component", async () => {
      expect(await lint(`import Button from "@/components/ui/Button"\nexport const A = () => <Button>Save</Button>\n`, COVERED)).toEqual([])
    })
  })

  describe("display dates", () => {
    it.each([
      "export const f = (d: Date) => d.toLocaleDateString()\n",
      "export const f = (d: Date) => d.toLocaleTimeString()\n",
      "export const f = (d: Date) => d.toLocaleString()\n",
      "export const f = () => new Intl.DateTimeFormat('en-AU')\n",
      "export const f = () => Intl.DateTimeFormat('en-AU')\n",
    ])("flags %s", async code => {
      const messages = await lint(code, "lib/new-thing.ts")
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatch(/lib\/date-format/)
    })

    it("passes in the formatter and in tests", async () => {
      const code = "export const f = () => new Intl.DateTimeFormat('en-AU')\n"
      expect(await lint(code, "lib/date-format.ts")).toEqual([])
      expect(await lint(code, "lib/__tests__/x.test.ts")).toEqual([])
    })

    it("passes on the formatter", async () => {
      expect(await lint(`import { formatDate } from "@/lib/date-format"\nexport const f = (d: Date) => formatDate(d)\n`, "lib/new-thing.ts")).toEqual([])
    })
  })

  describe("translucent colours", () => {
    it.each([
      `export const A = () => <p className="text-white/70" />\n`,
      `export const A = () => <p className="p-2 hover:bg-white/10" />\n`,
      "export const A = (x: boolean) => <p className={`p-2 ${x ? 'a' : 'bg-white/5'}`} />\n",
      "export const A = () => <p className={`p-2 text-white/80 ${1}`} />\n",
    ])("flags %s", async code => {
      const messages = await lint(code, COVERED)
      expect(messages.length).toBeGreaterThan(0)
      expect(messages[0]).toMatch(/Translucent/)
    })

    it("passes on solid tokens and on opaque white", async () => {
      expect(await lint(`export const A = () => <p className="text-text-on-brand bg-white" />\n`, COVERED)).toEqual([])
    })

    it("passes in the shared components", async () => {
      expect(await lint(`export const A = () => <p className="text-white/70" />\n`, "components/ui/Card.tsx")).toEqual([])
    })
  })

  describe("page widths", () => {
    it("flags max-w on main and on its direct child in a page file", async () => {
      const onMain = await lint(`export default function P() { return <main className="max-w-md" /> }\n`, PAGE)
      const onChild = await lint(`export default function P() { return <main><div className="mx-auto max-w-lg" /></main> }\n`, PAGE)
      expect(onMain).toHaveLength(1)
      expect(onChild).toHaveLength(1)
      expect(onMain[0]).toMatch(/PageContainer/)
    })

    it("passes on a modal width deeper in the page, and outside page files", async () => {
      const deep = `export default function P() { return <main><div><div className="max-w-sm" /></div></main> }\n`
      expect(await lint(deep, PAGE)).toEqual([])
      expect(await lint(`export const A = () => <main className="max-w-md" />\n`, COVERED)).toEqual([])
    })

    it("still reports the other rules in a page file", async () => {
      expect(await lint(`export default function P() { return <button /> }\n`, PAGE)).toHaveLength(1)
    })
  })
})
