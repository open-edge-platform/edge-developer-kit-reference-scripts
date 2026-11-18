// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { resolveObj2MjcfRunner } from '@/lib/process/pythonWorkerProcess';
import { runOneShotProcess } from '@/lib/process/runOneShotProcess';

export class Obj2MjcfError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'Obj2MjcfError';
  }
}

export interface Obj2MjcfResult {
  mjcf: string;
  files: string[];
}

/** obj2mjcf's stderr is a full Python traceback; the exception's own line is the useful part. */
function obj2mjcfErrorSummary(stderr: string): string {
  const lines = stderr.trim().split(/\r?\n/).filter(Boolean);
  return lines.at(-1) || 'unknown error';
}

/** The single work directory obj2mjcf created for the uploaded OBJ, e.g. `<dir>/<stem>`. */
export async function conversionWorkDirectory(directory: string): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  const directories = entries.filter((entry) => entry.isDirectory());
  return directories.length === 1 ? path.join(directory, directories[0].name) : null;
}

/**
 * Runs `obj2mjcf` against an OBJ (+ MTL + textures) already written to `directory` and returns the
 * generated MJCF body plus its mesh/texture filenames. Shared by the direct OBJ upload route and
 * the image-to-3D route, which both stage files under `dataPath('imageto3D', assetId)` first.
 */
export async function runObj2Mjcf(
  directory: string,
  projectPath: string,
  onLog?: (line: string) => void,
  signal?: AbortSignal,
  simulationReady = false,
): Promise<Obj2MjcfResult> {
  const runner = resolveObj2MjcfRunner(projectPath, simulationReady);
  const result = await runOneShotProcess(
    runner.command,
    [
      ...runner.args,
      '--obj-dir',
      directory,
      '--save-mjcf',
      '--overwrite',
      ...(simulationReady ? ['--decompose', '--coacd-args.max-convex-hull', '8'] : []),
    ],
    {
      cwd: projectPath,
      timeoutMs: 120_000,
      signal,
      onOutput: onLog ? (_stream, line) => onLog(line) : undefined,
    },
  );
  if (result.code !== 0) {
    throw new Obj2MjcfError(
      `obj2mjcf could not convert this object: ${obj2mjcfErrorSummary(result.stderr)}`,
      422,
    );
  }

  const workDirectory = await conversionWorkDirectory(directory);
  if (!workDirectory) throw new Obj2MjcfError('obj2mjcf did not produce an output folder.', 500);
  const workEntries = await readdir(/* turbopackIgnore: true */ workDirectory, {
    withFileTypes: true,
  });
  const xmlEntry = workEntries.find((entry) => entry.isFile() && entry.name.endsWith('.xml'));
  if (!xmlEntry) throw new Obj2MjcfError('obj2mjcf did not produce an MJCF file.', 500);

  const mjcf = await readFile(
    /* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ workDirectory, xmlEntry.name),
    'utf8',
  );
  const files = workEntries
    .filter((entry) => entry.isFile() && entry.name !== xmlEntry.name)
    .map((entry) => entry.name);

  if (simulationReady) {
    const collisions = files.filter((file) => /_collision_\d+\.obj$/i.test(file));
    if (!collisions.length || collisions.length > 8) {
      throw new Obj2MjcfError('Collision decomposition must produce between 1 and 8 hulls.', 422);
    }
    let triangles = 0;
    for (const filename of collisions) {
      const text = await readFile(
        /* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ workDirectory, filename),
        'utf8',
      );
      for (const line of text.split(/\r?\n/)) {
        if (/^f\s/.test(line)) triangles += line.trim().split(/\s+/).length - 3;
      }
    }
    if (triangles > 512) {
      throw new Obj2MjcfError(
        `Collision decomposition produced ${triangles} triangles; the simulation limit is 512. Simplify the source object before retrying.`,
        422,
      );
    }
    onLog?.(`Collision profile: ${collisions.length} convex hull(s), ${triangles} triangles`);
  }

  return { mjcf, files };
}
