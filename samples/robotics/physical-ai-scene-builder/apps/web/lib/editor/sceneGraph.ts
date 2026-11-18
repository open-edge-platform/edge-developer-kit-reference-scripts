// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { GeomType, type SceneGraph, type SceneNode } from '@mujoco-studio/types';

/**
 * MuJoCo geom group for authored geometry that collides and shows in the editor viewport but is
 * left out of camera images (browser camera preview and native renders, which draw groups 0-2).
 * Use it for a table or support box that stands in for a surface the splat backdrop renders.
 */
export const CAMERA_HIDDEN_GEOM_GROUP = 5;

export function isVisibleGeom(node: Pick<Extract<SceneNode, { kind: 'geom' }>, 'group'>): boolean {
  return node.group === CAMERA_HIDDEN_GEOM_GROUP || node.group < 3;
}

/** Whether a geom appears in camera images (camera preview, native Generate/Evaluate renders). */
export function isCameraVisibleGeom(
  node: Pick<Extract<SceneNode, { kind: 'geom' }>, 'group'>,
): boolean {
  return node.group !== CAMERA_HIDDEN_GEOM_GROUP && isVisibleGeom(node);
}

export function visualGeomIds(graph: SceneGraph, node: SceneNode): string[] {
  if (node.kind === 'geom') return isVisibleGeom(node) ? [node.id] : [];
  if (node.kind !== 'body') return [];

  const ids: string[] = [];
  const visit = (id: string) => {
    const child = graph.nodes[id];
    if (child.kind === 'geom' && isVisibleGeom(child)) ids.push(child.id);
    for (const childId of child.childIds) visit(childId);
  };
  visit(node.id);
  return ids;
}

export function isBoxSourceTarget(graph: SceneGraph | null, node: SceneNode | null): boolean {
  if (!graph || !node) return false;
  return visualGeomIds(graph, node).some(
    (id) => graph.nodes[id]?.kind === 'geom' && graph.nodes[id].geomType === GeomType.Box,
  );
}

export function isPlaceableSource(graph: SceneGraph | null, node: SceneNode | null): boolean {
  if (!graph || !node) return false;
  if (node.kind === 'body' && node.mjIndex <= 0) return false;
  if (node.kind !== 'body' && node.kind !== 'geom') return false;

  return visualGeomIds(graph, node).some(
    (id) => graph.nodes[id]?.kind === 'geom' && graph.nodes[id].geomType !== GeomType.Plane,
  );
}
