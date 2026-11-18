// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// Copies the MuJoCo WASM runtime out of node_modules into public/ so the browser
// can import it at runtime, bypassing the bundler (the Emscripten glue contains
// Node-only requires that break static bundling).
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = dirname(fileURLToPath(import.meta.resolve('@mujoco/mujoco')));
const outDir = join(process.cwd(), 'public', 'mujoco');

await mkdir(outDir, { recursive: true });

for (const file of ['mujoco.js', 'mujoco.wasm']) {
  await copyFile(join(pkgDir, file), join(outDir, file));
  console.log(`synced ${file} -> public/mujoco/${file}`);
}
