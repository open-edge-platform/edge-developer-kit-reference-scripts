// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const buildDirectoryNames = new Set(['.next', '.next-alt', '.turbo', 'out', 'dist', 'build']);
const removedPaths = [];

/**
 * The repository root and each npm workspace. Only their top level is cleaned: recursing would
 * reach Python/Pixi environments, colcon workspaces, and fetched CMake dependencies, whose own
 * `build`/`dist` directories are package contents, not this project's build output. Runtime data
 * (`data/`) is never a workspace, so it is never touched.
 */
async function cleanRoots() {
  const { workspaces = [] } = JSON.parse(
    await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
  );
  const roots = [repositoryRoot];
  for (const pattern of workspaces) {
    if (!pattern.endsWith('/*')) {
      roots.push(path.join(repositoryRoot, pattern));
      continue;
    }
    const parent = path.join(repositoryRoot, pattern.slice(0, -2));
    const entries = await readdir(parent, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) roots.push(path.join(parent, entry.name));
    }
  }
  return roots;
}

for (const root of await cleanRoots()) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    const isBuildDirectory = entry.isDirectory() && buildDirectoryNames.has(entry.name);
    const isBuildInfo = entry.isFile() && entry.name.endsWith('.tsbuildinfo');
    if (!isBuildDirectory && !isBuildInfo) continue;
    await rm(entryPath, { recursive: true, force: true });
    removedPaths.push(path.relative(repositoryRoot, entryPath));
  }
}

if (removedPaths.length === 0) {
  console.log('No build files found.');
} else {
  console.log(`Removed ${removedPaths.length} build path(s):`);
  for (const removedPath of removedPaths.sort()) console.log(`- ${removedPath}`);
}
