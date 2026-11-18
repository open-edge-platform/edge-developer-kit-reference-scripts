// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { BodyNode, CameraNode, GeomNode } from '@mujoco-studio/types';
import type * as THREE from 'three';

import type { MeshObjectPlacement } from '@/lib/editor/document';

export interface GeomEntry {
  node: GeomNode;
  geometry: THREE.BufferGeometry;
}

export interface MarqueePoint {
  x: number;
  y: number;
}

export interface TransformCommit {
  node: BodyNode | CameraNode | GeomNode;
  mode: 'translate' | 'rotate' | 'scale';
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  quaternion: readonly [number, number, number, number];
  scale: readonly [number, number, number];
  /**
   * The node was rotated or scaled about a pivot other than its own origin, so `position` changed
   * too and must be committed with the orientation.
   */
  pivoted?: boolean;
}

export interface DraggedAssetPreview {
  id: number;
  name: string;
  dimensions: readonly [number, number, number];
}

export interface FocusRequest {
  ids: readonly string[];
}

export interface OrbitControlsLike {
  target: THREE.Vector3;
  update: () => void;
}

export interface PlacementCandidate extends MeshObjectPlacement {
  assetId: number;
  normal: readonly [number, number, number];
}

export interface ViewportHandle {
  focusSelection: (ids?: readonly string[]) => void;
  focusNode: (id: string) => void;
}
