// eslint flat config for js-v3 client
// two configs: minimal (no-dynamic-imports only) and full (recommended rules)
// use: npm run lint (minimal) or npm run lint:full (all rules)
import tsparser from "@typescript-eslint/parser";
import tseslint from "@typescript-eslint/eslint-plugin";
import solid from "eslint-plugin-solid";

const minimalConfig = [
  {
    ignores: ["node_modules/**", "dist/**", "build/**", "storybook-static/**"],
  },
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      solid,
    },
    rules: {
      // disallow dynamic imports - use static imports at the top of the file
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message:
            "dynamic imports are not allowed. use static imports at the top of the file instead.",
        },
      ],

      // solid reactivity rules (critical for correct behavior)
      "solid/reactivity": "warn",
      "solid/no-destructure": "warn",
      "solid/prefer-for": "warn",
    },
  },
];

const fullConfig = [
  {
    ignores: ["node_modules/**", "dist/**", "build/**", "storybook-static/**"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      solid,
    },
    rules: {
      // typescript recommended rules
      ...tseslint.configs.recommended.rules,

      // solid recommended rules
      ...solid.configs.typescript.rules,

      // disallow dynamic imports
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message:
            "dynamic imports are not allowed. use static imports at the top of the file instead.",
        },
      ],

      // allow unused vars that start with underscore
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // allow explicit any for now (can tighten later)
      "@typescript-eslint/no-explicit-any": "off",

      // prefer const over let when possible
      "prefer-const": "warn",

      // no var declarations
      "no-var": "error",

      // require === and !== instead of == and !=
      eqeqeq: ["warn", "always"],

      // disallow console.log in production code (use console.error/warn for important stuff)
      "no-console": [
        "warn",
        {
          allow: ["warn", "error"],
        },
      ],

      // enforce consistent return statements
      "consistent-return": "off", // solid components often don't return

      // disallow empty functions (except arrow functions used as stubs)
      "no-empty-function": [
        "warn",
        {
          allow: ["arrowFunctions"],
        },
      ],

      // disallow unnecessary semicolons
      "no-extra-semi": "error",

      // no unused expressions
      "no-unused-expressions": [
        "warn",
        {
          allowShortCircuit: true,
          allowTernary: true,
        },
      ],
    },
  },
  // allow console in logger utility
  {
    files: ["src/utils/logger.ts"],
    rules: {
      "no-console": "off",
    },
  },
];

// export minimal by default, full can be selected via env var
export default process.env.ESLINT_FULL === "true" ? fullConfig : minimalConfig;
