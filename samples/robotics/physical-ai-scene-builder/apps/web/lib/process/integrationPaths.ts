// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path';

/**
 * Where the app finds its Python projects. Each one is configurable for packaged installs; the
 * defaults are the source checkout, relative to `apps/web` (the server's working directory).
 */
function configuredOrSource(variable: string, sourcePath: string): string {
  return path.resolve(
    process.env[variable]?.trim() ||
      path.resolve(/* turbopackIgnore: true */ process.cwd(), sourcePath),
  );
}

/** The `robotic_studio` uv project (`integrations/python`): workers, examples, training bundle. */
export function integrationPath(): string {
  return configuredOrSource('ROBOTIC_STUDIO_PYTHONPATH', '../../integrations/python');
}

/** The GLB to OBJ conversion project used by image-to-3D imports. */
export function glb2objPath(): string {
  return configuredOrSource('ROBOTIC_STUDIO_GLB2OBJ_PATH', '../../services/glb2obj');
}

/** The TRELLIS.2 image-to-3D service project, when the app starts it. */
export function trellisPath(): string {
  return configuredOrSource('ROBOTIC_STUDIO_TRELLIS_PATH', '../../services/trellis2-runtime');
}
