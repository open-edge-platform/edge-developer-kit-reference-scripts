// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Mujoco } from './runtime';

export interface RuntimeFile {
  path: string;
  bytes: Uint8Array;
  checksum: string;
  kind?: 'mesh' | 'texture' | 'splat';
  /**
   * Splat backdrop calibration scale (`kind: 'splat'` only): body-frame points are
   * `splatScale * R(splatRotation) * p_raw`. Sent to workers as `profile.backdrop.scale`.
   */
  splatScale?: number;
  /**
   * Splat backdrop calibration rotation (`kind: 'splat'` only) as a unit quaternion
   * `[w, x, y, z]`, applied to raw PLY points before `splatScale`. Sent to workers as
   * `profile.backdrop.rotation`; identity when omitted.
   */
  splatRotation?: readonly [number, number, number, number];
}

const stagedByRuntime = new WeakMap<Mujoco, Map<string, string>>();

function checksumsFor(mujoco: Mujoco): Map<string, string> {
  let checksums = stagedByRuntime.get(mujoco);
  if (!checksums) {
    checksums = new Map();
    stagedByRuntime.set(mujoco, checksums);
  }
  return checksums;
}

export function normalizeRuntimePath(path: string): string {
  const normalized = path.replace(/^\/+/, '');
  if (
    !normalized ||
    normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('Runtime asset paths must be relative and must not contain traversal segments');
  }
  return normalized;
}

/**
 * Writes generated mesh artifacts into MuJoCo's Emscripten filesystem.
 * Repeated staging of unchanged content is intentionally a no-op. Splat PLYs are never staged:
 * MuJoCo does not read them (the backdrop collision is an inline hfield), and they can be large.
 */
export function stageRuntimeFiles(mujoco: Mujoco, files: readonly RuntimeFile[]): void {
  const stagedChecksums = checksumsFor(mujoco);
  for (const file of files) {
    if (file.kind === 'splat') continue;
    const path = normalizeRuntimePath(file.path);
    if (!file.checksum) throw new Error(`Runtime file "${path}" is missing a checksum`);
    if (!file.bytes.byteLength) throw new Error(`Runtime file "${path}" is empty`);
    if (stagedChecksums.get(path) === file.checksum) continue;

    const directory = path.slice(0, Math.max(path.lastIndexOf('/'), 0));
    if (directory) mujoco.FS.mkdirTree(directory, 0o777);
    mujoco.FS.writeFile(path, file.bytes);
    stagedChecksums.set(path, file.checksum);
  }
}

/** Removes only app-staged files; callers must retain files referenced by undo/redo history. */
export function retainRuntimeFiles(mujoco: Mujoco, paths: ReadonlySet<string>): void {
  const checksums = checksumsFor(mujoco);
  const retained = new Set([...paths].map(normalizeRuntimePath));
  for (const path of checksums.keys()) {
    if (retained.has(path)) continue;
    try {
      mujoco.FS.unlink(path);
    } catch {
      // Already gone (e.g. the runtime FS was reset); forgetting the checksum is all that is left.
    }
    checksums.delete(path);
  }
}

/** Releases staged bytes as well as checksums when their scene owner is disposed. */
export function clearStagedRuntimeFiles(mujoco: Mujoco): void {
  retainRuntimeFiles(mujoco, new Set());
  stagedByRuntime.delete(mujoco);
}
