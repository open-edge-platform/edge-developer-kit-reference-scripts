// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Simulation } from '@mujoco-studio/mujoco';
import type { BodyNode, GeomNode, SceneGraph, SceneNode } from '@mujoco-studio/types';
import { GeomType, JointType } from '@mujoco-studio/types';
import * as THREE from 'three';

import { isSplatBackdropNode } from '@/lib/editor/document';
import { isVisibleGeom } from '@/lib/editor/sceneGraph';
import { backdropPivot, type Vec3Tuple } from '@/lib/editor/splatCollision';
import {
  matrixFromRuntime,
  MUJOCO_TO_THREE,
  THREE_TO_MUJOCO,
} from '@/lib/editor/runtimeTransforms';
import type { TransformCommit } from '@/lib/editor/viewportTypes';

export const SELECTION_EMISSIVE = new THREE.Color('#ff8a3d').multiplyScalar(0.5);
export const HOVER_EMISSIVE = new THREE.Color('#4cc4e0').multiplyScalar(0.28);
export const GENERATION_SOURCE_EMISSIVE = new THREE.Color('#27d3c2').multiplyScalar(0.55);
export const BLACK = new THREE.Color('#000000');

export function owningBodyId(graph: SceneGraph, node: GeomNode): string | null {
  const parent = node.parentId ? graph.nodes[node.parentId] : null;
  return parent?.kind === 'body' && parent.mjIndex > 0 ? parent.id : null;
}

/**
 * The top-level body owning `node` when it is a whole, non-articulated object (no robot and not
 * the splat backdrop): such objects scale uniformly as one, meshes included.
 */
export function scalableObjectBody(graph: SceneGraph, node: SceneNode): BodyNode | null {
  let current: SceneNode | undefined = node;
  while (current) {
    const parent: SceneNode | undefined = current.parentId
      ? graph.nodes[current.parentId]
      : undefined;
    if (current.kind === 'body' && parent?.kind === 'body' && parent.mjIndex === 0) break;
    current = parent;
  }
  if (current?.kind !== 'body' || isSplatBackdropNode(current)) return null;
  const articulated = (id: string): boolean => {
    const child = graph.nodes[id];
    return (
      (child.kind === 'joint' && child.jointType !== JointType.Free) ||
      child.childIds.some(articulated)
    );
  };
  if (articulated(current.id) || !affectedGeomIndices(graph, current).length) return null;
  return current;
}

/**
 * Primitive geoms scale their `size`; top-level objects scale as a whole. Mesh geoms take their
 * size from the mesh, so they only scale with their object.
 */
export function canScaleNode(
  graph: SceneGraph | null,
  node: SceneNode | null | undefined,
): boolean {
  if (!graph || !node) return false;
  if (node.kind === 'body') return scalableObjectBody(graph, node) !== null;
  if (node.kind !== 'geom' || isSplatBackdropNode(node)) return false;
  return node.geomType !== GeomType.Mesh || scalableObjectBody(graph, node) !== null;
}

export function transformTarget(
  graph: SceneGraph,
  selectedIds: string[],
  mode: TransformCommit['mode'],
): BodyNode | GeomNode | null {
  if (selectedIds.length !== 1) return null;
  const selected = graph.nodes[selectedIds[0]];
  if (selected?.kind === 'body') {
    if (mode === 'scale') return scalableObjectBody(graph, selected);
    return selected.mjIndex > 0 ? selected : null;
  }
  if (selected?.kind === 'geom' && mode === 'scale' && selected.geomType === GeomType.Mesh) {
    return scalableObjectBody(graph, selected);
  }
  // The backdrop heightfield geom only moves with its body.
  return selected?.kind === 'geom' && !isSplatBackdropNode(selected) ? selected : null;
}

/**
 * Transform pivot in the node's own frame, or null to pivot at the node origin. The splat
 * backdrop body's origin is the raw PLY origin, which can lie far outside the scan, so it pivots
 * at the scan center on the floor (`backdropPivot`) while its alignment origin is known.
 */
export function transformPivotOffset(
  node: Pick<SceneNode, 'kind' | 'name'>,
  splatOrigin: Vec3Tuple | null,
  splatLevel: number,
): THREE.Vector3 | null {
  if (node.kind !== 'body' || !isSplatBackdropNode(node) || !splatOrigin) return null;
  return new THREE.Vector3(...backdropPivot(splatOrigin, splatLevel));
}

export function placementTargetForGeom(graph: SceneGraph, node: GeomNode): BodyNode | GeomNode {
  let parentId = node.parentId;
  while (parentId) {
    const parent = graph.nodes[parentId];
    if (!parent) break;
    if (parent.kind === 'body') return parent.mjIndex > 0 ? parent : node;
    parentId = parent.parentId;
  }
  return node;
}

export function affectedGeomIndices(graph: SceneGraph, node: BodyNode | GeomNode): number[] {
  if (node.kind === 'geom') return [node.mjIndex];
  const indices: number[] = [];
  const visit = (id: string) => {
    const child = graph.nodes[id];
    if (child.kind === 'geom') indices.push(child.mjIndex);
    for (const childId of child.childIds) visit(childId);
  };
  visit(node.id);
  return indices;
}

export function isSelectedGeom(graph: SceneGraph, node: GeomNode, selectedIds: string[]): boolean {
  if (selectedIds.includes(node.id)) return true;
  let parentId = node.parentId;
  while (parentId) {
    if (selectedIds.includes(parentId)) return true;
    parentId = graph.nodes[parentId]?.parentId ?? null;
  }
  return false;
}

/**
 * Commits a node's new scene-frame (MuJoCo world) matrix as a parent-relative transform.
 */
export function commitSceneMatrix(
  simulation: Simulation,
  graph: SceneGraph,
  target: TransformCommit['node'],
  mode: TransformCommit['mode'],
  sceneMatrix: THREE.Matrix4,
  onTransformCommit: (commit: TransformCommit) => void,
): void {
  const localMatrix = sceneMatrix.clone();
  const parent = target.parentId ? graph.nodes[target.parentId] : null;
  if (parent?.kind === 'body') {
    localMatrix.premultiply(matrixFromRuntime(simulation, parent).invert());
  }

  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  localMatrix.decompose(position, quaternion, scale);
  const rotation = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  onTransformCommit({
    node: target,
    mode,
    position: [position.x, position.y, position.z],
    rotation: [rotation.x, rotation.y, rotation.z],
    quaternion: [quaternion.w, quaternion.x, quaternion.y, quaternion.z],
    scale: [scale.x, scale.y, scale.z],
  });
}

export function commitWorldTranslation(
  simulation: Simulation,
  graph: SceneGraph,
  target: BodyNode | GeomNode,
  delta: THREE.Vector3,
  onTransformCommit: (commit: TransformCommit) => void,
): void {
  const worldDelta = delta.clone().applyQuaternion(THREE_TO_MUJOCO);
  const worldMatrix = matrixFromRuntime(simulation, target);
  const worldPosition = new THREE.Vector3().setFromMatrixPosition(worldMatrix).add(worldDelta);
  commitSceneMatrix(
    simulation,
    graph,
    target,
    'translate',
    worldMatrix.clone().setPosition(worldPosition),
    onTransformCommit,
  );
}

export function supportExtent(
  normal: THREE.Vector3,
  dimensions: readonly [number, number, number],
): number {
  return (
    Math.abs(normal.x) * dimensions[0] * 0.5 +
    Math.abs(normal.y) * dimensions[1] * 0.5 +
    Math.abs(normal.z) * dimensions[2] * 0.5
  );
}

export function rotationForNormal(normal: THREE.Vector3): [number, number, number, number] {
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    normal.clone().normalize(),
  );
  return [quaternion.w, quaternion.x, quaternion.y, quaternion.z];
}

export function threeQuaternionFromMujoco(
  rotation: readonly [number, number, number, number],
): THREE.Quaternion {
  return new THREE.Quaternion(rotation[1], rotation[2], rotation[3], rotation[0]);
}

export function worldSizeForDimensions(
  dimensions: readonly [number, number, number],
): THREE.Vector3 {
  return new THREE.Vector3(dimensions[0], dimensions[2], dimensions[1]);
}

export function sceneGeomBoxes(scene: THREE.Scene, graph: SceneGraph | null): THREE.Box3[] {
  const boxes: THREE.Box3[] = [];
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData.placementPreview) return;
    const nodeId = object.userData.nodeId;
    const node = typeof nodeId === 'string' ? graph?.nodes[nodeId] : null;
    if (
      !node ||
      node.kind !== 'geom' ||
      node.geomType === GeomType.Plane ||
      node.geomType === GeomType.HeightField ||
      !isVisibleGeom(node)
    ) {
      return;
    }
    const box = new THREE.Box3().setFromObject(object);
    if (!box.isEmpty()) boxes.push(box);
  });
  return boxes;
}

export function collisionClearance(
  position: THREE.Vector3,
  dimensions: readonly [number, number, number],
  boxes: readonly THREE.Box3[],
): number {
  const worldPosition = position.clone().applyQuaternion(MUJOCO_TO_THREE);
  const worldSize = worldSizeForDimensions(dimensions);
  const candidateRadius = worldSize.length() / 2;
  let clearance = 0;

  for (const box of boxes) {
    const closest = box.clampPoint(worldPosition, new THREE.Vector3());
    const distance = worldPosition.distanceTo(closest);
    if (distance < candidateRadius)
      clearance = Math.max(clearance, candidateRadius - distance + 0.02);
  }
  return clearance;
}

export function nodeIsWithinFocus(
  graph: SceneGraph,
  nodeId: string,
  focusIds: ReadonlySet<string>,
): boolean {
  if (focusIds.has(nodeId)) return true;
  let parentId = graph.nodes[nodeId]?.parentId ?? null;
  while (parentId) {
    if (focusIds.has(parentId)) return true;
    parentId = graph.nodes[parentId]?.parentId ?? null;
  }
  return false;
}

export function visibleGeomBoundsForSelection(
  scene: THREE.Scene,
  graph: SceneGraph,
  ids: readonly string[],
): THREE.Box3 | null {
  const focusIds = new Set(ids);
  const bounds = new THREE.Box3();

  scene.traverse((object) => {
    if (!object.visible) return;
    const nodeId = object.userData.nodeId;
    if (typeof nodeId !== 'string') return;
    const node = graph.nodes[nodeId];
    if (
      !node ||
      node.kind !== 'geom' ||
      node.geomType === GeomType.Plane ||
      !isVisibleGeom(node) ||
      !nodeIsWithinFocus(graph, nodeId, focusIds)
    ) {
      return;
    }
    bounds.union(new THREE.Box3().setFromObject(object));
  });

  return bounds.isEmpty() ? null : bounds;
}

export function focusBoundsForSelection(
  scene: THREE.Scene,
  graph: SceneGraph,
  ids: readonly string[],
): THREE.Box3 | null {
  const focusIds = new Set(ids);
  const bounds = visibleGeomBoundsForSelection(scene, graph, ids) ?? new THREE.Box3();

  scene.traverse((object) => {
    if (!object.visible) return;

    const nodeId = object.userData.nodeId;
    if (typeof nodeId === 'string') return;

    const authoredCamera = object.userData.authoredCamera;
    if (
      typeof authoredCamera !== 'string' ||
      !focusIds.has(authoredCamera) ||
      object.parent?.userData.authoredCamera === authoredCamera
    ) {
      return;
    }
    bounds.union(new THREE.Box3().setFromObject(object));
  });

  return bounds.isEmpty() ? null : bounds;
}
