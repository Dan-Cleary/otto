// Flat ESLint config for the Otto monorepo. Intentionally minimal —
// we error on things that are clearly bugs, warn on things that are
// usually intentional. Tighten over time, don't try to boil the ocean
// on day 1.
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "app/public/otto.js",
      "convex/_generated/**",
      "**/*.cjs",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        crypto: "readonly",
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        Headers: "readonly",
        Request: "readonly",
        Response: "readonly",
        fetch: "readonly",
        AbortController: "readonly",
        FormData: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      react: reactPlugin,
      "react-hooks": reactHooks,
    },
    settings: {
      react: { version: "18" },
    },
    rules: {
      // Errors: clear bugs.
      "no-undef": "off", // TS handles this
      "no-debugger": "error",
      "no-self-compare": "error",
      "no-unsafe-finally": "error",
      "no-unreachable": "error",
      "no-duplicate-case": "error",
      "no-empty-pattern": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "react-hooks/rules-of-hooks": "error",

      // Warnings: probably intentional, surface for review.
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "off",
      "react/react-in-jsx-scope": "off",
    },
  },
];
