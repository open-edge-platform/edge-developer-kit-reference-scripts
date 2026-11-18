// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CameraNode, SceneGraph } from '@mujoco-studio/types';

import { RENDER_CAMERA_MAX_SIZE, type RenderCameraInput } from './contracts';

/** Default image size for free views, matching the common recording size. */
export const FREE_VIEW_SIZE = { width: 640, height: 480 } as const;

export type RenderTarget =
  | { kind: 'camera'; node: CameraNode }
  | {
      kind: 'free';
      position: [number, number, number];
      target: [number, number, number];
      fovy: number;
    };

/** Resolves `render_camera` input to a scene camera or a free view, or throws an agent-facing error. */
export function resolveRenderTarget(graph: SceneGraph, input: RenderCameraInput): RenderTarget {
  if (Boolean(input.camera) === Boolean(input.view)) {
    throw new Error('Give exactly one of camera (a scene camera name) or view (a free view).');
  }
  if (input.camera) {
    const cameras = Object.values(graph.nodes).filter(
      (node): node is CameraNode => node.kind === 'camera',
    );
    const node = cameras.find((camera) => camera.name === input.camera);
    if (!node) {
      const names = cameras.map((camera) => camera.name).filter(Boolean);
      throw new Error(
        `No scene camera named "${input.camera}". Cameras: ${names.length ? names.join(', ') : 'none'}.`,
      );
    }
    return { kind: 'camera', node };
  }
  const view = input.view!;
  const distance = Math.hypot(
    view.target[0] - view.position[0],
    view.target[1] - view.position[1],
    view.target[2] - view.position[2],
  );
  if (distance < 1e-6) throw new Error('A free view needs a target away from its position.');
  return { kind: 'free', position: view.position, target: view.target, fovy: view.fovy };
}

/**
 * Pixel size of a render: the requested size, or the camera's recorded size. A single requested
 * side keeps the aspect ratio, and the result never exceeds `RENDER_CAMERA_MAX_SIZE` per side.
 */
export function renderSize(
  base: { width: number; height: number },
  requested: { width?: number; height?: number },
): { width: number; height: number } {
  const aspect = base.width / base.height;
  let width = requested.width ?? (requested.height ? requested.height * aspect : base.width);
  let height = requested.height ?? (requested.width ? requested.width / aspect : base.height);
  const scale = Math.min(1, RENDER_CAMERA_MAX_SIZE / Math.max(width, height));
  width = Math.max(16, Math.round(width * scale));
  height = Math.max(16, Math.round(height * scale));
  return { width, height };
}
