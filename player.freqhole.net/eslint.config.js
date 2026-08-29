import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import solidPlugin from "eslint-plugin-solid";
import globals from "globals";

const baseConfig = {
    languageOptions: {
        parser: tsparser,
        ecmaVersion: "latest",
        sourceType: "module",
    },
    plugins: {
        "@typescript-eslint": tseslint,
    },
    rules: {
        ...tseslint.configs.recommended.rules,
        "@typescript-eslint/no-unused-vars": [
            "warn",
            {
                argsIgnorePattern: "^_",
                varsIgnorePattern: "^_",
                caughtErrorsIgnorePattern: "^_",
            },
        ],
        "@typescript-eslint/explicit-function-return-type": "off",
        "@typescript-eslint/no-explicit-any": "warn",
        "no-undef": "off",
        "no-empty": ["error", { allowEmptyCatch: true }],
    },
};

export default [
    { ignores: ["dist/**", "node_modules/**", "test-results/**", "playwright-report/**"] },
    js.configs.recommended,

    // typescript files
    {
        files: ["src/**/*.ts"],
        ...baseConfig,
        languageOptions: {
            ...baseConfig.languageOptions,
            globals: globals.browser,
        },
    },

    // typescript + jsx files
    {
        files: ["src/**/*.tsx"],
        ...baseConfig,
        languageOptions: {
            ...baseConfig.languageOptions,
            parserOptions: { ecmaFeatures: { jsx: true } },
            globals: globals.browser,
        },
        plugins: {
            ...baseConfig.plugins,
            solid: solidPlugin,
        },
        rules: {
            ...baseConfig.rules,
            ...solidPlugin.configs.recommended.rules,
        },
    },

    // e2e tests + build/config files (node context)
    {
        files: ["e2e/**/*.ts", "config/**/*.ts"],
        ...baseConfig,
        languageOptions: {
            ...baseConfig.languageOptions,
            globals: globals.node,
        },
    },
];
