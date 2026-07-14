import { defineConfig } from "eslint-config-zoro";

export default defineConfig({
  react: true,
  typescript: true,
  ignores: [
    "**/artifacts/**",
    "**/build/**",
    "**/coverage/**",
    "**/dist/**",
    "**/out/**",
    ".agents/**",
    "apps/desktop/src/components/ui/**"
  ],
  languageOptions: {
    parserOptions: {
      project: "./tsconfig.eslint.json"
    }
  },
  rules: {
    "@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: true }],
    "@stylistic/indent": ["error", 2, { "SwitchCase": 1, "flatTernaryExpressions": true }],
    "@stylistic/indent-binary-ops": ["error", 2],
    "@stylistic/jsx-indent-props": ["error", 2]
  }
});
