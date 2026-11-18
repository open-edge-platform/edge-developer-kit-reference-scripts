// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { zipSync, type Zippable } from 'fflate';

import { integrationPath, readPythonProjectSources } from '@/lib/teleoperation/sessionManager';

// Shipped at the archive root as README.md; kept next to the example scripts it documents.
const README_FILE = 'evaluation-README.md';

const EXAMPLE_SCRIPTS = [
  'physicalai_evaluate_pi05.py',
  'physicalai_evaluate_act.py',
  // Turns a Physical AI training checkpoint (.ckpt) into the package the two scripts above load.
  'physicalai_convert_to_openvino.py',
  'lerobot_evaluate_pi05.py',
  'lerobot_evaluate_act.py',
] as const;

export async function buildEvaluationExampleArchive(): Promise<Uint8Array<ArrayBuffer>> {
  const projectRoot = integrationPath();
  const [readme, exampleSources, projectManifest, lockfile, projectSources] = await Promise.all([
    readFile(path.join(projectRoot, 'examples', README_FILE), 'utf8'),
    Promise.all(
      EXAMPLE_SCRIPTS.map((name) => readFile(path.join(projectRoot, 'examples', name), 'utf8')),
    ),
    readFile(path.join(projectRoot, 'pyproject.toml'), 'utf8'),
    readFile(path.join(projectRoot, 'uv.lock'), 'utf8'),
    readPythonProjectSources(path.join(projectRoot, 'robotic_studio')),
  ]);
  const encoder = new TextEncoder();
  const files: Zippable = {
    'README.md': encoder.encode(readme),
    'pyproject.toml': encoder.encode(projectManifest),
    'uv.lock': encoder.encode(lockfile),
  };
  EXAMPLE_SCRIPTS.forEach((name, index) => {
    files[name] = encoder.encode(exampleSources[index]);
  });
  for (const [filePath, contents] of Object.entries(projectSources)) {
    files[filePath] = encoder.encode(contents);
  }
  return zipSync(files);
}
