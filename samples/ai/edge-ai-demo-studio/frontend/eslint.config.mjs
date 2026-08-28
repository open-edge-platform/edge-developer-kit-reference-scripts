// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FlatCompat } from "@eslint/eslintrc";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const compat = new FlatCompat({
  // import.meta.dirname is available after Node.js v20.11.0
  baseDirectory: import.meta.dirname,
});

// ─── Sample modularity: forbid static imports of optional services ──────────
//
// Optional service integrations are wired through the generated feature-provider
// registry (`@/services/_generated/feature-providers`) so the export tool
// (scripts/export-bundle.mjs) can prune their folders with `--no-optional`.
// The export walks the *static* import graph and force-includes any service
// folder it reaches — so a sample that statically imports a service it declares
// `optional` drags that folder back in and silently defeats `--no-optional`.
// This rule reads each sample's data.ts and flags those imports.
// See docs/OPTIONAL-SERVICES.md.

const SAMPLES_DIR = join(import.meta.dirname, "src", "samples");
// Mirrors the dependency parser in scripts/export-bundle.mjs (serviceId before
// role, no nested braces — matches the shape of ServiceDependency literals).
const DEP_RE =
  /\{\s*serviceId\s*:\s*['"]([\w-]+)['"][^{}]*?role\s*:\s*['"](required|optional)['"][^{}]*?\}/gs;
const optionalDepsCache = new Map();

function optionalServiceIds(sampleId) {
  const cached = optionalDepsCache.get(sampleId);
  if (cached) return cached;
  const ids = new Set();
  try {
    const src = readFileSync(join(SAMPLES_DIR, sampleId, "data.ts"), "utf8");
    DEP_RE.lastIndex = 0;
    let m;
    while ((m = DEP_RE.exec(src)) !== null) {
      if (m[2] === "optional") ids.add(m[1]);
    }
  } catch {
    // Folder has no data.ts (not a sample) — nothing to enforce.
  }
  optionalDepsCache.set(sampleId, ids);
  return ids;
}

const sampleModularityPlugin = {
  rules: {
    "no-optional-service-imports": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow a sample from statically importing a service it declares as an optional dependency; optional services must be reached only through the generated feature-provider registry so the export tool can prune them with --no-optional.",
        },
        schema: [],
        messages: {
          optionalImport:
            "Sample '{{sample}}' statically imports optional service '{{service}}' ('{{source}}'). A static import drags the service folder back into the export graph, so `--no-optional` can no longer prune it. Wire optional services through @/services/_generated/feature-providers (useFeatureProviders) or a shared @/context bridge instead. See docs/OPTIONAL-SERVICES.md.",
        },
      },
      create(context) {
        const filename = (context.filename ?? context.getFilename()).replace(
          /\\/g,
          "/",
        );
        const m = filename.match(/\/src\/samples\/([^/]+)\//);
        if (!m) return {};
        const sampleId = m[1];
        // `common` (shared barrels) and `_generated` are not samples and have no
        // per-sample role context to enforce.
        if (sampleId === "common" || sampleId === "_generated") return {};
        const optional = optionalServiceIds(sampleId);
        if (optional.size === 0) return {};

        const check = (node) => {
          const value = node?.value;
          if (typeof value !== "string") return;
          // Only `@/services/<id>/...` specifiers carry a service folder; shared
          // entrypoints (_generated, common, types, registry) never match an
          // optional service id and are therefore allowed.
          const svc = value.match(/^@\/services\/([^/]+)(?:\/|$)/);
          if (svc && optional.has(svc[1])) {
            context.report({
              node,
              messageId: "optionalImport",
              data: { sample: sampleId, service: svc[1], source: value },
            });
          }
        };

        return {
          ImportDeclaration: (node) => check(node.source),
          ExportNamedDeclaration: (node) => check(node.source),
          ExportAllDeclaration: (node) => check(node.source),
          ImportExpression: (node) => check(node.source),
        };
      },
    },
  },
};

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
    files: ["src/lib/logger.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["src/services/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/samples", "@/samples/**", "**/samples/**"],
              message:
                "Layering violation: services must not import from the samples tree (samples sit above services). This keeps services independently prunable and avoids a samples↔services cycle. Put shared contracts in @/context, @/hooks, or @/types. See docs/ARCHITECTURE-LAYERS.md and docs/OPTIONAL-SERVICES.md.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/engines/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/samples",
                "@/samples/**",
                "**/samples/**",
                "@/services",
                "@/services/**",
                "**/services/**",
              ],
              message:
                "Layering violation: engines are the bottom layer and must not import from the services or samples trees. Keep engines self-contained; put any shared contract in @/components, @/context, @/hooks, @/lib, or @/types instead. See docs/ARCHITECTURE-LAYERS.md.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/samples/**/*.{ts,tsx}"],
    plugins: { "sample-modularity": sampleModularityPlugin },
    rules: {
      "sample-modularity/no-optional-service-imports": "error",
    },
  },
  {
    settings: {
      react: { version: "19" },
    },
  },
]);

export default eslintConfig;
