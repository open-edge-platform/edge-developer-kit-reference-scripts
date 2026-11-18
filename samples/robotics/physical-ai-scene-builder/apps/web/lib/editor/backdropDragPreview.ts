// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import * as THREE from 'three';

/**
 * Live transform-drag delta of the splat backdrop body. The authored MJCF only changes when a
 * drag commits, so the rendered splat (which follows the body's runtime pose) reads this while a
 * drag is in progress to move with the gizmo preview.
 */
export const backdropDragPreview = {
  /** Scene-graph id of the dragged backdrop body, or null when no backdrop drag is active. */
  nodeId: null as string | null,
  /** Scene-frame (MuJoCo world) delta: previewed = delta * committed. */
  delta: new THREE.Matrix4(),
};

export function beginBackdropDragPreview(nodeId: string): void {
  backdropDragPreview.nodeId = nodeId;
  backdropDragPreview.delta.identity();
}

export function updateBackdropDragPreview(delta: THREE.Matrix4): void {
  if (backdropDragPreview.nodeId) backdropDragPreview.delta.copy(delta);
}

export function endBackdropDragPreview(): void {
  backdropDragPreview.nodeId = null;
  backdropDragPreview.delta.identity();
}
