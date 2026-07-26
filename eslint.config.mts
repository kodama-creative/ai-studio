import { defineConfig } from "eslint-config-zoro";

export default [
  ...await defineConfig({
    react: true,
    typescript: true,
    ignores: [
      "**/artifacts/**",
      "**/build/**",
      "**/coverage/**",
      "**/dist/**",
      "**/.generated/**",
      "**/out/**",
      ".agents/**",
      "apps/desktop/src/components/ui/**"
    ],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: true }],
      "@stylistic/indent": ["error", 2, { "SwitchCase": 1, "flatTernaryExpressions": true }],
      "@stylistic/indent-binary-ops": ["error", 2],
      "@stylistic/jsx-indent-props": ["error", 2],
      "@stylistic/jsx-pascal-case": ["error", { allowLeadingUnderscore: true }],
      "@stylistic/max-statements-per-line": "off",
      "@stylistic/multiline-ternary": "off",
      "@typescript-eslint/member-ordering": "off",
      "@typescript-eslint/no-shadow": "off",
      "@typescript-eslint/no-use-before-define": "off",
      "@typescript-eslint/parameter-properties": "off",
      "@typescript-eslint/prefer-nullish-coalescing": "off",
      "new-cap": ["error", { capIsNewExceptions: ["Compile"], properties: false }],
      "max-classes-per-file": ["error", 2],
      "no-console": ["warn", { allow: ["error", "warn"] }],
      "no-nested-ternary": "off",
      "no-void": "off"
    }
  }),
  {
    files: [
      "apps/desktop/postcss.config.js",
      "apps/desktop/scripts/**",
      "apps/desktop/src/bun/**",
      "scripts/**"
    ],
    languageOptions: {
      globals: {
        module: "readonly"
      }
    },
    rules: {
      "no-console": "off",
      "react/jsx-props-no-spreading": "off"
    }
  },
  {
    files: [
      "apps/desktop/src/bun/external-projects/external-agent-project-manager.test.ts",
      "packages/runtime/src/node/connections/project-mcp-session.test.ts",
      "packages/runtime/src/node/connections/remote-mcp-client.test.ts"
    ],
    rules: {
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/prefer-promise-reject-errors": "off"
    }
  },
  {
    files: [
      "apps/desktop/src/bun/app/dirty-agent-source-coordinator.test.ts",
      "apps/desktop/src/bun/host/desktop-host.test.ts"
    ],
    rules: {
      "@typescript-eslint/strict-void-return": "off"
    }
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off"
    }
  },
  {
    files: [
      "apps/desktop/src/bun/host/desktop-host.ts",
      "apps/desktop/src/bun/tools/tool-registry.ts"
    ],
    rules: {
      "@typescript-eslint/no-invalid-void-type": "off"
    }
  },
  {
    files: [
      "apps/desktop/src/bun/external-projects/external-agent-project-manager.ts",
      "apps/desktop/src/bun/streaming/stream-thread.ts",
      "apps/desktop/src/client/rpc-transport.ts",
      "apps/desktop/src/components/thread-playground/run-evaluation-scorecard.tsx",
      "apps/desktop/src/components/thread-playground/stores/thread-store.ts",
      "apps/desktop/src/components/thread-playground/tool/built-in-tool-import-dialog.tsx",
      "apps/desktop/src/mainview/main.tsx",
      "packages/core/src/client/reducer.ts",
      "packages/core/src/parsers/json-thread-parser.ts",
      "packages/core/src/server/agent/stream.ts",
      "packages/core/src/thread/history.ts",
      "packages/core/src/thread/prompt-variables.ts",
      "packages/core/src/utils/extract-initials.ts",
      "packages/runtime/src/execution/tool-execution-policy.ts",
      "packages/runtime/src/node/connections/project-mcp-session.ts",
      "packages/runtime/src/runtime/agent/agent-runtime.ts"
    ],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off"
    }
  },
  {
    files: ["**/*.tsx"],
    rules: {
      "react/hook-use-state": "off",
      "react/jsx-no-bind": "off",
      "react/jsx-props-no-spreading": "off",
      "react/no-array-index-key": "off",
      "react/no-unused-prop-types": "off"
    }
  }
];
