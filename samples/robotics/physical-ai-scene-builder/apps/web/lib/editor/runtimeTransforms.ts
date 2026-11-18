// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { MUJOCO_ROOT_ROTATION_X } from '@mujoco-studio/scene';
import type { BodyNode, CameraNode, GeomNode, SceneGraph, SiteNode } from '@mujoco-studio/types';
import type { Simulation } from '@mujoco-studio/mujoco';
import * as THREE from 'three';

export type RuntimeTransformNode = BodyNode | GeomNode | CameraNode | SiteNode;

export interface ViewportCameraPose {
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  fovy: number;
}

export interface MountedCameraPose {
  body: BodyNode;
  position: readonly [number, number, number];
  rotation: readonly [number, number, number, number];
}

export const MUJOCO_TO_THREE = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  MUJOCO_ROOT_ROTATION_X,
);
export const THREE_TO_MUJOCO = MUJOCO_TO_THREE.clone().invert();

function runtimeArrays(
  simulation: Simulation,
  node: RuntimeTransformNode,
): { positions: Float64Array; rotations: Float64Array } {
  switch (node.kind) {
    case 'body':
      return { positions: simulation.bodyPositions, rotations: simulation.bodyRotations };
    case 'geom':
      return { positions: simulation.geomPositions, rotations: simulation.geomRotations };
    case 'camera':
      return { positions: simulation.cameraPositions, rotations: simulation.cameraRotations };
    case 'site':
      return { positions: simulation.sitePositions, rotations: simulation.siteRotations };
  }
}

export function matrixFromRuntime(
  simulation: Simulation,
  node: RuntimeTransformNode,
): THREE.Matrix4 {
  const { positions, rotations } = runtimeArrays(simulation, node);
  const positionIndex = node.mjIndex * 3;
  const rotationIndex = node.mjIndex * 9;

  return new THREE.Matrix4().set(
    rotations[rotationIndex],
    rotations[rotationIndex + 1],
    rotations[rotationIndex + 2],
    positions[positionIndex],
    rotations[rotationIndex + 3],
    rotations[rotationIndex + 4],
    rotations[rotationIndex + 5],
    positions[positionIndex + 1],
    rotations[rotationIndex + 6],
    rotations[rotationIndex + 7],
    rotations[rotationIndex + 8],
    positions[positionIndex + 2],
    0,
    0,
    0,
    1,
  );
}

export function rotationFromMatrix(values: Float64Array, index: number): THREE.Quaternion {
  const offset = index * 9;
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().set(
      values[offset],
      values[offset + 1],
      values[offset + 2],
      0,
      values[offset + 3],
      values[offset + 4],
      values[offset + 5],
      0,
      values[offset + 6],
      values[offset + 7],
      values[offset + 8],
      0,
      0,
      0,
      0,
      1,
    ),
  );
}

export function threePosition(values: Float64Array, index: number): THREE.Vector3 {
  const offset = index * 3;
  return new THREE.Vector3(values[offset], values[offset + 1], values[offset + 2]);
}

export function mujocoPointFromThree(
  values: readonly [number, number, number],
): readonly [number, number, number] {
  const point = new THREE.Vector3(...values).applyQuaternion(THREE_TO_MUJOCO);
  return [point.x, point.y, point.z];
}

export function mountedCameraPoseFor(
  simulation: Simulation,
  graph: SceneGraph,
  node: BodyNode | SiteNode,
): MountedCameraPose | null {
  const body =
    node.kind === 'body'
      ? node
      : node.parentId && graph.nodes[node.parentId]?.kind === 'body'
        ? graph.nodes[node.parentId]
        : null;
  if (!body || body.kind !== 'body' || body.mjIndex <= 0) return null;

  const anchorMatrix = matrixFromRuntime(simulation, node);
  const bodyMatrix = matrixFromRuntime(simulation, body);
  const opticalAxisAlignment = new THREE.Matrix4().makeRotationY(Math.PI);
  const localMatrix = bodyMatrix
    .clone()
    .invert()
    .multiply(anchorMatrix)
    .multiply(opticalAxisAlignment);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  localMatrix.decompose(position, quaternion, scale);

  return {
    body,
    position: [position.x, position.y, position.z],
    rotation: [quaternion.w, quaternion.x, quaternion.y, quaternion.z],
  };
}
