// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import type { SceneGraph } from '@mujoco-studio/types';
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';

import { useEditorStore } from '@/lib/store/editorStore';
import { owningBodyId } from '@/lib/editor/viewportGeometry';
import type { MarqueePoint } from '@/lib/editor/viewportTypes';

export function MarqueeSelection({
  start,
  graph,
  meshRefs,
  onChange,
  onEnd,
}: {
  start: MarqueePoint | null;
  graph: SceneGraph;
  meshRefs: React.MutableRefObject<Map<number, THREE.Mesh>>;
  onChange: (point: MarqueePoint) => void;
  onEnd: () => void;
}) {
  const { camera, gl } = useThree();
  const setSelection = useEditorStore((state) => state.setSelection);

  useEffect(() => {
    if (!start) return;
    const element = gl.domElement;
    const toLocal = (event: PointerEvent): MarqueePoint => {
      const bounds = element.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };
    const move = (event: PointerEvent) => onChange(toLocal(event));
    const end = (event: PointerEvent) => {
      const point = toLocal(event);
      const left = Math.min(start.x, point.x);
      const right = Math.max(start.x, point.x);
      const top = Math.min(start.y, point.y);
      const bottom = Math.max(start.y, point.y);
      const bounds = element.getBoundingClientRect();
      const worldPosition = new THREE.Vector3();
      const selectedIds = new Set<string>();
      for (const [index, mesh] of meshRefs.current) {
        mesh.getWorldPosition(worldPosition);
        worldPosition.project(camera);
        const x = ((worldPosition.x + 1) / 2) * bounds.width;
        const y = ((1 - worldPosition.y) / 2) * bounds.height;
        const geom = graph.nodes[`geom:${index}`];
        if (x >= left && x <= right && y >= top && y <= bottom && geom?.kind === 'geom') {
          selectedIds.add(owningBodyId(graph, geom) ?? geom.id);
        }
      }
      setSelection([...selectedIds]);
      onEnd();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
  }, [camera, gl, graph, meshRefs, onChange, onEnd, setSelection, start]);

  return null;
}
