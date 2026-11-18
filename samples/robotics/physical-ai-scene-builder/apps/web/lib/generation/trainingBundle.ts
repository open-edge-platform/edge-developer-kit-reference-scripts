// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Files from `integrations/python/training`, copied to the same relative paths at the root of the
 * raw dataset archive. The directory is a standalone uv project; regenerate its `uv.lock` with
 * `uv lock --project integrations/python/training` after editing its `pyproject.toml`.
 */
export const TRAINING_BUNDLE_FILES = [
  'README.md',
  'pyproject.toml',
  'uv.lock',
  'convert_to_lerobot.py',
  'lerobot_train_act.sh',
  'lerobot_train_pi05.sh',
  'physicalai_train_act.sh',
  'physicalai_train_pi05.sh',
  'configs/physicalai_act.yaml',
  'configs/physicalai_pi05.yaml',
] as const;

export function trainingBundleDirectory(integrationRoot: string): string {
  return path.join(integrationRoot, 'training');
}

export async function readTrainingBundle(integrationRoot: string): Promise<Record<string, string>> {
  const root = trainingBundleDirectory(integrationRoot);
  const files = await Promise.all(
    TRAINING_BUNDLE_FILES.map(
      async (relativePath) =>
        [
          relativePath,
          await readFile(/* turbopackIgnore: true */ path.join(root, relativePath), 'utf8'),
        ] as const,
    ),
  );
  return Object.fromEntries(files);
}
