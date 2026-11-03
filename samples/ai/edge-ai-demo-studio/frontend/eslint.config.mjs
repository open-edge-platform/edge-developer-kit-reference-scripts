// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { FlatCompat } from "@eslint/eslintrc";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const compat = new FlatCompat({
  // import.meta.dirname is available after Node.js v20.11.0
  baseDirectory: import.meta.dirname,
});

// Sample modularity: the export tool walks the static import graph, so a sample that statically
// imports a service it declares optional defeats `--no-optional`. Optional services go through
// @/services/_generated/feature-providers. See docs/OPTIONAL-SERVICES.md.

const SAMPLES_DIR = join(import.meta.dirname, "src", "samples");
// Mirrors scripts/export-bundle.mjs's parser: serviceId before role, stopping at role so a nested
// object after it (e.g. `recommended: { device }`) does not hide the dependency.
const DEP_RE =
  /\{\s*serviceId\s*:\s*['"]([\w-]+)['"][^{}]*?role\s*:\s*['"](required|optional)['"]/gs;
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
        // `common` and `_generated` are not samples.
        if (sampleId === "common" || sampleId === "_generated") return {};
        const optional = optionalServiceIds(sampleId);
        if (optional.size === 0) return {};

        const check = (node) => {
          const value = node?.value;
          if (typeof value !== "string") return;
          // Only `@/services/<id>/...` names a service folder; shared entrypoints never match an id.
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

// Client/server boundary: client modules ship to the browser with everything they import, so Node
// built-ins, Payload and server-only src/lib modules must stay out. Not `server-only`: Payload's
// CLI loads these modules outside Next. Type-only imports are erased and always allowed.

const SRC_DIR = join(import.meta.dirname, "src");
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);
const SERVER_ONLY_IMPORTS = [
  /^node:/,
  /^@payload-config$/,
  /^payload(\/|$)/,
  /^@payloadcms\//,
  /^@\/payload(\/|\.config$|$)/,
  /^@\/lib\/(workers|system|deployment|api)(\/|$)/,
  /^@\/lib\/(constants|app-boot)$/,
  /^@\/lib\/settings\/(app-settings-store|sample-settings-store|field-encryption)$/,
  /^@\/lib\/llm\/(mcp-tools|chat-stream|chat-prompts|ovms-provider|lipsync-forwarder)$/,
  /^@\/engines\/_generated\/engines$/,
  /^@\/engines\/[^/]+\/(server|paths|process-handler|draft-engine|diagnosis)$/,
];
// Folders whose modules only ever run in the browser, with or without a
// 'use client' directive of their own.
const CLIENT_FOLDERS = /\/src\/(hooks|components|context|lib\/browser)\//;

/** `source` as an `@/` path when it is relative and inside src/, else as is. */
function toAliasPath(source, filename) {
  if (!source.startsWith(".")) return source;
  const target = relative(SRC_DIR, resolve(dirname(filename), source));
  return target.startsWith("..") ? source : `@/${target.replace(/\\/g, "/")}`;
}

function isServerOnly(source) {
  return (
    NODE_BUILTINS.has(source) ||
    SERVER_ONLY_IMPORTS.some((pattern) => pattern.test(source))
  );
}

const clientBoundaryPlugin = {
  rules: {
    "no-server-imports": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow client modules ('use client' files and src/{hooks,components,context,lib/browser}) from importing Node built-ins, Payload or server-only lib/engine modules.",
        },
        schema: [],
        messages: {
          serverImport:
            "Client module imports server-only '{{source}}'. It would ship to the browser with everything it imports. Move the code it needs into an isomorphic module, or call a route; type-only imports (`import type`) are fine.",
        },
      },
      create(context) {
        const filename = (context.filename ?? context.getFilename()).replace(
          /\\/g,
          "/",
        );
        const body = context.sourceCode?.ast?.body ?? [];
        const usesClient = body.some(
          (node) =>
            node.type === "ExpressionStatement" &&
            node.directive === "use client",
        );
        if (!usesClient && !CLIENT_FOLDERS.test(filename)) return {};

        const check = (node, typeOnly) => {
          const value = node?.source?.value;
          if (typeOnly || typeof value !== "string") return;
          const source = toAliasPath(value, filename);
          if (isServerOnly(source)) {
            context.report({
              node: node.source,
              messageId: "serverImport",
              data: { source: value },
            });
          }
        };
        const onlyTypes = (node) =>
          node.importKind === "type" ||
          node.exportKind === "type" ||
          (node.specifiers?.length > 0 &&
            node.specifiers.every(
              (s) => s.importKind === "type" || s.exportKind === "type",
            ));

        return {
          ImportDeclaration: (node) => check(node, onlyTypes(node)),
          ExportNamedDeclaration: (node) =>
            node.source && check(node, onlyTypes(node)),
          ExportAllDeclaration: (node) => check(node, node.exportKind === "type"),
          ImportExpression: (node) => check(node, false),
        };
      },
    },
  },
};

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
// Loopback is the same on every machine, so it is not a personal address.
const LOOPBACK_RE = /^127\./;

const noHardcodedDevOriginPlugin = {
  rules: {
    "no-hardcoded-dev-origin": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow hardcoded IPv4 addresses other than loopback in next.config.ts's allowedDevOrigins array; these are personal/LAN addresses and must not be committed.",
        },
        schema: [],
        messages: {
          hardcodedIp:
            "Hardcoded IP '{{value}}' in allowedDevOrigins. This is a personal/LAN address for local testing — remove it before committing (read it from an env var instead if it needs to be configurable).",
        },
      },
      create(context) {
        return {
          Property(node) {
            const keyName = node.key?.name ?? node.key?.value;
            if (keyName !== "allowedDevOrigins") return;
            if (node.value.type !== "ArrayExpression") return;
            for (const el of node.value.elements) {
              if (
                el?.type === "Literal" &&
                typeof el.value === "string" &&
                IPV4_RE.test(el.value) &&
                !LOOPBACK_RE.test(el.value)
              ) {
                context.report({
                  node: el,
                  messageId: "hardcodedIp",
                  data: { value: el.value },
                });
              }
            }
          },
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
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "client-boundary": clientBoundaryPlugin },
    rules: {
      "client-boundary/no-server-imports": "error",
    },
  },
  {
    files: ["next.config.ts"],
    plugins: { "local-guards": noHardcodedDevOriginPlugin },
    rules: {
      "local-guards/no-hardcoded-dev-origin": "error",
    },
  },
  {
    settings: {
      react: { version: "19" },
    },
  },
]);

export default eslintConfig;
