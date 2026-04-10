// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { FlatCompat } from "@eslint/eslintrc";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const compat = new FlatCompat({
  // import.meta.dirname is available after Node.js v20.11.0
  baseDirectory: import.meta.dirname,
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/app/(payload)/admin/**",
    "eslint.config.mjs",
    "playwright-report/**",
    "test-results/**",
    "package.json",
    "package-lock.json",
  ]),
  ...compat.config({
    extends: ["plugin:prettier/recommended"],
    plugins: ["prettier"],
    rules: {
      "no-console": "error",
      "prettier/prettier": [
        "error",
        {
          trailingComma: "all",
          semi: false,
          tabWidth: 2,
          singleQuote: true,
          printWidth: 80,
          endOfLine: "auto",
          arrowParens: "always",
          plugins: ["prettier-plugin-tailwindcss"],
        },
        {
          usePrettierrc: false,
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "variableLike",
          format: ["UPPER_CASE", "camelCase", "PascalCase"],
          leadingUnderscore: "allow",
          trailingUnderscore: "forbid",
        },
      ],
    },
  }),
  {
    files: ["tests/**", "**/*.spec.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    settings: {
      react: { version: "19" },
    },
  },
]);

export default eslintConfig;
