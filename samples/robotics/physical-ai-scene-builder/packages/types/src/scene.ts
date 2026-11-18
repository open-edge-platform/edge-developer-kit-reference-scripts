// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { GeomType, JointType, LightType, Rgba, SensorType, Vec3 } from './geometry';

export type SceneNodeKind = 'body' | 'geom' | 'joint' | 'light' | 'camera' | 'site' | 'sensor';

export interface SceneNodeBase {
  /** Stable id, unique within a scene graph. */
  id: string;
  kind: SceneNodeKind;
  name: string;
  /** Index into the corresponding MuJoCo model array. */
  mjIndex: number;
  parentId: string | null;
  childIds: string[];
}

export interface BodyNode extends SceneNodeBase {
  kind: 'body';
  mass: number;
}

export interface GeomNode extends SceneNodeBase {
  kind: 'geom';
  geomType: GeomType;
  size: Vec3;
  rgba: Rgba;
  group: number;
  /** Compiled MuJoCo material name, or null when the geom uses inline RGBA. */
  materialName: string | null;
  /** Index into `model.mesh_*` when `geomType` is `Mesh`, otherwise -1. */
  meshId: number;
}

export interface JointNode extends SceneNodeBase {
  kind: 'joint';
  jointType: JointType;
  axis: Vec3;
  range: readonly [number, number];
  limited: boolean;
}

export interface LightNode extends SceneNodeBase {
  kind: 'light';
  lightType: LightType;
  /** Compiled spot cone half-angle in degrees (`light_cutoff`; MuJoCo default 45). */
  cutoff: number;
  /** Compiled spot falloff: brightness scales by cos(angle off axis)^exponent (default 10). */
  exponent: number;
}

export interface CameraNode extends SceneNodeBase {
  kind: 'camera';
  fovy: number;
}

export interface SiteNode extends SceneNodeBase {
  kind: 'site';
}

export interface SensorNode extends SceneNodeBase {
  kind: 'sensor';
  sensorType: SensorType;
  objectType: number;
  objectId: number;
  dimension: number;
}

export type SceneNode =
  BodyNode | GeomNode | JointNode | LightNode | CameraNode | SiteNode | SensorNode;

export interface SceneGraph {
  rootId: string;
  nodes: Record<string, SceneNode>;
  /** Depth-first ordering of node ids, for stable list rendering. */
  order: string[];
}
