// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();
const runtimeRoot = '/payload-runtime/node_modules';

fs.rmSync('/payload-runtime', { force: true, recursive: true });
fs.mkdirSync(runtimeRoot, { recursive: true });

function packageRoot(packageName, fromDirectory) {
  let directory = fromDirectory;

  while (directory !== path.dirname(directory)) {
    const packageDirectory = path.join(directory, 'node_modules', packageName);
    const manifestPath = path.join(packageDirectory, 'package.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.name === packageName) return packageDirectory;
    }
    directory = path.dirname(directory);
  }

  throw new Error(`Could not locate the package root for ${packageName}.`);
}

function copyPackage(packageName, fromDirectory) {
  const sourceDirectory = packageRoot(packageName, fromDirectory);
  const destinationDirectory = path.join(runtimeRoot, packageName);
  fs.mkdirSync(path.dirname(destinationDirectory), { recursive: true });
  fs.cpSync(sourceDirectory, destinationDirectory, { recursive: true });
  return {
    directory: sourceDirectory,
    manifest: JSON.parse(fs.readFileSync(path.join(sourceDirectory, 'package.json'), 'utf8')),
  };
}

const queue = [
  { name: 'payload', from: workspaceRoot },
  { name: '@payloadcms/db-postgres', from: workspaceRoot },
  { name: '@payloadcms/richtext-lexical', from: workspaceRoot },
  { name: 'sharp', from: workspaceRoot },
  { name: 'tsx', from: workspaceRoot },
];
const visited = new Set();

while (queue.length > 0) {
  const entry = queue.shift();
  const sourceDirectory = packageRoot(entry.name, entry.from);
  if (visited.has(sourceDirectory)) continue;
  visited.add(sourceDirectory);

  const { directory, manifest } = copyPackage(entry.name, entry.from);
  const optionalDependencies = new Set(Object.keys(manifest.optionalDependencies ?? {}));
  const peerDependencies = new Set(Object.keys(manifest.peerDependencies ?? {}));
  const dependencies = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);

  for (const dependency of dependencies) {
    try {
      packageRoot(dependency, directory);
      queue.push({ name: dependency, from: directory });
    } catch (error) {
      if (
        !optionalDependencies.has(dependency) &&
        !peerDependencies.has(dependency) &&
        !dependency.startsWith('@types/')
      ) {
        throw error;
      }
    }
  }
}
