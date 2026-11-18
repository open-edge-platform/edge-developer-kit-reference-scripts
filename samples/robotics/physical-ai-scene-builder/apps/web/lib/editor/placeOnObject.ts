// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import * as THREE from 'three';

export type PlaceOnObjectFailure = 'invalid-source' | 'invalid-target';

export type PlaceOnObjectResult =
  | {
      ok: true;
      delta: THREE.Vector3;
      sourceBottomCenter: THREE.Vector3;
      targetTopCenter: THREE.Vector3;
    }
  | { ok: false; reason: PlaceOnObjectFailure };

const DEFAULT_CLEARANCE = 0;

function isFiniteBox(bounds: THREE.Box3): boolean {
  return (
    !bounds.isEmpty() &&
    [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z].every(
      Number.isFinite,
    )
  );
}

export function resolveCenteredPlacement(
  sourceBounds: THREE.Box3,
  targetBounds: THREE.Box3,
  clearance = DEFAULT_CLEARANCE,
): PlaceOnObjectResult {
  if (!isFiniteBox(sourceBounds)) return { ok: false, reason: 'invalid-source' };
  if (!isFiniteBox(targetBounds)) return { ok: false, reason: 'invalid-target' };
  if (!Number.isFinite(clearance) || clearance < 0) {
    return { ok: false, reason: 'invalid-target' };
  }

  const sourceBottomCenter = new THREE.Vector3(
    (sourceBounds.min.x + sourceBounds.max.x) * 0.5,
    sourceBounds.min.y,
    (sourceBounds.min.z + sourceBounds.max.z) * 0.5,
  );
  const targetTopCenter = new THREE.Vector3(
    (targetBounds.min.x + targetBounds.max.x) * 0.5,
    targetBounds.max.y + clearance,
    (targetBounds.min.z + targetBounds.max.z) * 0.5,
  );

  return {
    ok: true,
    delta: targetTopCenter.clone().sub(sourceBottomCenter),
    sourceBottomCenter,
    targetTopCenter,
  };
}
