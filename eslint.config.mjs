import nextConfig from "eslint-config-next"

/** @type {import("eslint").Linter.Config[]} */
const eslintConfig = [
  {
    ignores: [".claude/worktrees/**"],
  },
  ...nextConfig,
  {
    rules: {
      // react-hooks v7 (bundled with eslint-config-next 16): strict React Compiler–oriented rules.
      // Typical data-fetch effects and harmless impure wrappers are flagged across this app.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
  },
]

export default eslintConfig
