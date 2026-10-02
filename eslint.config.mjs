import nextConfig from "eslint-config-next"
import reactX from "eslint-plugin-react-x"
import tseslint from "typescript-eslint"
import * as espree from "espree"

/** @type {import("eslint").Linter.Config[]} */
const eslintConfig = [
  {
    ignores: [".claude/worktrees/**"],
  },
  ...nextConfig,
  // eslint-plugin-react (bundled by eslint-config-next) is unmaintained and incompatible with
  // ESLint 10 (calls the removed context.getFilename() API). Its react/* rules are disabled
  // below and replaced by eslint-plugin-react-x, which is ESLint-10-ready.
  reactX.configs["recommended-typescript"],
  // eslint-config-next's own bundled parser (a vendored @babel/eslint-parser fork, baked into
  // its dist rather than a swappable dependency) crashes under ESLint 10 for plain JS files
  // (scopeManager.addGlobals is not a function). Route these through plain parsers instead.
  // .mts/.cts were never covered by eslint-config-next's own typescript-eslint entry (files:
  // ["**/*.ts", "**/*.tsx"] only), so they hit the same broken bundled parser too.
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    languageOptions: {
      parser: espree,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
  },
  {
    files: ["**/*.{mts,cts}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { sourceType: "module" },
    },
  },
  {
    rules: {
      // react-hooks v7 (bundled with eslint-config-next 16): strict React Compiler–oriented rules.
      // Typical data-fetch effects and harmless impure wrappers are flagged across this app.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",

      // Disabled: eslint-plugin-react is unmaintained and crashes under ESLint 10 (see above).
      // All 17 of its active rules go off together, since they share a Components helper that
      // cascades the same crash regardless of which individual rule triggers first.
      "react/display-name": "off",
      "react/jsx-key": "off",
      "react/jsx-no-comment-textnodes": "off",
      "react/jsx-no-duplicate-props": "off",
      "react/jsx-no-undef": "off",
      "react/jsx-uses-react": "off",
      "react/jsx-uses-vars": "off",
      "react/no-children-prop": "off",
      "react/no-danger-with-children": "off",
      "react/no-deprecated": "off",
      "react/no-direct-mutation-state": "off",
      "react/no-find-dom-node": "off",
      "react/no-is-mounted": "off",
      "react/no-render-return-value": "off",
      "react/no-string-refs": "off",
      "react/no-unescaped-entities": "off",
      "react/require-render-return": "off",

      // eslint-plugin-react-x re-implements these under its own namespace, duplicating
      // eslint-plugin-react-hooks v7's existing (and already tuned) coverage of the same
      // concepts. Keep react-hooks/* as the source of truth to avoid double-reporting.
      "react-x/exhaustive-deps": "off",
      "react-x/purity": "off",
      "react-x/set-state-in-effect": "off",
      "react-x/set-state-in-render": "off",
      "react-x/no-direct-mutation-state": "off",
    },
  },
]

export default eslintConfig
