// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path';

/**
 * Root directory for runtime data: asset uploads, generated artifacts, recordings, and datasets.
 *
 * The location comes only from the environment so that bundlers and output tracing never resolve
 * it to files in the source tree. Relative values resolve from the web app's working directory;
 * source development uses `../../data` (the repository `data/` folder) via `apps/web/.env`.
 */
export function dataDirectory(): string {
  const configured = process.env.ROBOTIC_STUDIO_DATA_DIR?.trim();
  if (!configured) {
    throw new Error(
      'ROBOTIC_STUDIO_DATA_DIR is not set. Source development sets it in apps/web/.env ' +
        '(see apps/web/.env.example).',
    );
  }
  return path.resolve(configured);
}

export function dataPath(...segments: string[]): string {
  return path.join(dataDirectory(), ...segments);
}
