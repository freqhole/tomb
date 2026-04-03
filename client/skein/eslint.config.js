// eslint flat config for skein

import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    ignores: ["node_modules/", "dist/", "coverage/", "playwright-report/", "test-results/"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // ban dynamic imports — use static imports
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message: "dynamic import() is banned — use static imports",
        },
      ],

      // base rules
      "prefer-const": "warn",
      "no-var": "error",
      eqeqeq: ["warn", "always"],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-empty-function": ["warn", { allow: ["arrowFunctions"] }],
      "no-extra-semi": "error",
      "no-unused-expressions": "warn",

      // typescript rules
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
