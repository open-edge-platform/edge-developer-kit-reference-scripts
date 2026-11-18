// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { MjModel } from '@mujoco/mujoco';

/**
 * Camera clipping distances, in meters, shared by every scene camera.
 *
 * MuJoCo's own `<visual><map znear zfar>` are fractions of the compiled scene extent, so the same
 * MJCF value means a different distance whenever the scene grows (a splat room makes the extent
 * ~14 m, turning `znear="0.01"` into a 14 cm near plane that cuts a wrist camera's gripper away).
 * The studio therefore stores meters in `<custom><numeric name="rs_camera_clipping" data="near
 * far"/>` and every runtime (this one and the native Python workers, see
 * `robotic_studio/camera_clipping.py`) rewrites the compiled model's map from it on load.
 */
export const CAMERA_CLIPPING_NUMERIC = 'rs_camera_clipping';
export const DEFAULT_CAMERA_NEAR_M = 0.01;
export const DEFAULT_CAMERA_FAR_M = 50;

export interface CameraClipping {
  near: number;
  far: number;
}

/** Valid clipping distances from authored values, falling back to the defaults. */
export function normalizeCameraClipping(
  values: ArrayLike<number> | null | undefined,
): CameraClipping {
  const near = Number(values?.[0]);
  const far = Number(values?.[1]);
  const validNear = Number.isFinite(near) && near > 0 ? near : DEFAULT_CAMERA_NEAR_M;
  const validFar =
    Number.isFinite(far) && far > validNear ? far : Math.max(DEFAULT_CAMERA_FAR_M, validNear * 2);
  return { near: validNear, far: validFar };
}

function authoredClipping(model: MjModel, decode: (adr: number) => string): number[] | null {
  const names = model.name_numericadr as Int32Array;
  const addresses = model.numeric_adr as Int32Array;
  const sizes = model.numeric_size as Int32Array;
  const data = model.numeric_data as Float64Array;
  for (let index = 0; index < model.nnumeric; index++) {
    if (decode(names[index]) !== CAMERA_CLIPPING_NUMERIC) continue;
    return Array.from(data.subarray(addresses[index], addresses[index] + sizes[index]));
  }
  return null;
}

/** Sets the compiled model's extent-relative map so cameras clip at the authored meters. */
export function applyCameraClipping(
  model: MjModel,
  decode: (adr: number) => string,
): CameraClipping {
  const clipping = normalizeCameraClipping(authoredClipping(model, decode));
  const extent = model.stat.extent > 0 ? model.stat.extent : 1;
  model.vis.map.znear = clipping.near / extent;
  model.vis.map.zfar = clipping.far / extent;
  return clipping;
}
