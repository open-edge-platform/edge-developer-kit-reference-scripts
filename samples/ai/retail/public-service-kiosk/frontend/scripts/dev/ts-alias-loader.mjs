// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");
const CANDIDATE_EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

function isRelative(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function existingFile(candidate) {
  return existsSync(candidate) && statSync(candidate).isFile() ? candidate : null;
}

function resolveOnDisk(basePath) {
  for (const suffix of CANDIDATE_EXTENSIONS) {
    const found = existingFile(basePath + suffix);
    if (found) return found;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  let basePath = null;
  if (specifier.startsWith("@/")) {
    basePath = path.join(SRC_ROOT, specifier.slice(2));
  } else if (isRelative(specifier) && context.parentURL?.startsWith("file:")) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    basePath = path.resolve(parentDir, specifier);
  }

  if (basePath) {
    const resolved = resolveOnDisk(basePath);
    if (resolved) {
      return nextResolve(pathToFileURL(resolved).href, context);
    }
  }

  return nextResolve(specifier, context);
}
