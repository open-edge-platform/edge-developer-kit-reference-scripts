// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { RuntimeFile } from '@mujoco-studio/mujoco';
import { SPLAT_BACKDROP_BODY, type TeleoperationBackdropV1 } from '@mujoco-studio/types';

/**
 * `profile.backdrop` for the worker runtime files: the splat PLY path, the static MJCF body that
 * poses it, its calibration scale and rotation (`q_body = scale * R * p_raw`, `R` as a unit
 * quaternion `[w, x, y, z]`), and the SHA-256 of the PLY. Empty without a splat.
 */
export function backdropProfile(
  runtimeFiles: readonly RuntimeFile[],
  body: string | null = SPLAT_BACKDROP_BODY,
): { backdrop?: TeleoperationBackdropV1 } {
  const splat = runtimeFiles.find((file) => file.kind === 'splat');
  if (!splat) return {};
  return {
    backdrop: {
      asset: splat.path,
      body: body ?? SPLAT_BACKDROP_BODY,
      scale: splat.splatScale && splat.splatScale > 0 ? splat.splatScale : 1,
      rotation: unitQuaternion(splat.splatRotation),
      hash: splat.checksum,
    },
  };
}

/**
 * Why a native session must not start yet: the scene has a scanned-room backdrop body but its
 * splat is not loaded, so cameras would record without the room (unlike Generate's recordings
 * and the preview). Null when ready.
 */
export function backdropNotReady(
  backdropBody: string | null,
  runtimeFiles: readonly RuntimeFile[],
): string | null {
  if (!backdropBody || runtimeFiles.some((file) => file.kind === 'splat')) return null;
  return 'The scanned room has not finished loading, so cameras would see the scene without it. Wait until it appears in the viewport (or fix it in the Splat tab), then start again.';
}

function unitQuaternion(value: readonly number[] | undefined): [number, number, number, number] {
  if (value?.length === 4 && value.every(Number.isFinite)) {
    const norm = Math.hypot(...value);
    if (norm > 1e-9) return [value[0] / norm, value[1] / norm, value[2] / norm, value[3] / norm];
  }
  return [1, 0, 0, 0];
}
