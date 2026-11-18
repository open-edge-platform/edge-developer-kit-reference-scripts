// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Simulation } from '@mujoco-studio/mujoco';
import type * as THREE from 'three';

/**
 * MuJoCo is Z-up while Three.js is Y-up. Applying this rotation to the scene
 * root lets geom transforms be copied verbatim from `mjData`.
 */
export const MUJOCO_ROOT_ROTATION_X = -Math.PI / 2;

/**
 * Copies a geom's world transform out of `mjData` onto an object.
 *
 * `mjData.geom_xmat` is a row-major 3x3 matrix, which matches the argument
 * order of `Matrix4.set`.
 */
export function applyGeomTransform(
  sim: Simulation,
  geomIndex: number,
  target: THREE.Object3D,
): void {
  const xpos = sim.geomPositions;
  const xmat = sim.geomRotations;
  const p = geomIndex * 3;
  const m = geomIndex * 9;

  // prettier-ignore
  target.matrix.set(
    xmat[m], xmat[m + 1], xmat[m + 2], xpos[p],
    xmat[m + 3], xmat[m + 4], xmat[m + 5], xpos[p + 1],
    xmat[m + 6], xmat[m + 7], xmat[m + 8], xpos[p + 2],
    0, 0, 0, 1,
  );
  target.matrixWorldNeedsUpdate = true;
}
