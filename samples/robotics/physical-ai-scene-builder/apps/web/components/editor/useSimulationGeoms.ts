// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { usePhysics } from '@mujoco-studio/mujoco';
import { applyGeomTransform, createGeomGeometry } from '@mujoco-studio/scene';
import { GeomType } from '@mujoco-studio/types';
import { useThree, useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import type * as THREE from 'three';

import { isVisibleGeom } from '@/lib/editor/sceneGraph';
import type { GeomEntry } from '@/lib/editor/viewportTypes';

export function useSimulationGeomEntries(
  meshRefs?: React.MutableRefObject<Map<number, THREE.Mesh>>,
) {
  const { graph, getSimulation } = usePhysics();
  const entries = useMemo<GeomEntry[]>(() => {
    const simulation = getSimulation();
    if (!graph || !simulation) return [];

    const result: GeomEntry[] = [];
    const meshGeometries = new Map<number, THREE.BufferGeometry>();
    for (const id of graph.order) {
      const node = graph.nodes[id];
      if (node.kind !== 'geom' || !isVisibleGeom(node)) continue;
      let geometry: THREE.BufferGeometry | null;
      if (node.geomType === GeomType.Mesh && node.meshId >= 0) {
        geometry = meshGeometries.get(node.meshId) ?? null;
        if (!geometry) {
          geometry = createGeomGeometry(simulation, node);
          if (geometry) meshGeometries.set(node.meshId, geometry);
        }
      } else {
        geometry = createGeomGeometry(simulation, node);
      }
      if (geometry) result.push({ node, geometry });
    }
    return result;
  }, [graph, getSimulation]);

  useEffect(() => {
    const meshes = meshRefs?.current;
    return () => {
      for (const geometry of new Set(entries.map((entry) => entry.geometry))) geometry.dispose();
      meshes?.clear();
    };
  }, [entries, meshRefs]);

  return { entries, getSimulation, graph };
}

export function useSimulationGeomTransforms(
  meshRefs: React.MutableRefObject<Map<number, THREE.Mesh>>,
  skippedGeomIndices: readonly number[] | null,
  advanceSimulation: boolean,
) {
  const { getSimulation, loop } = usePhysics();
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => loop.subscribe(() => invalidate()), [invalidate, loop]);

  useFrame((_state, delta) => {
    if (advanceSimulation) loop.advance(delta);
    if (advanceSimulation && loop.isRunning) invalidate();

    const simulation = getSimulation();
    if (!simulation) return;
    for (const [geomIndex, mesh] of meshRefs.current) {
      if (skippedGeomIndices?.includes(geomIndex)) continue;
      applyGeomTransform(simulation, geomIndex, mesh);
    }
  });
}
