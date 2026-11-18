// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { usePhysics } from '@mujoco-studio/mujoco';
import { MUJOCO_ROOT_ROTATION_X } from '@mujoco-studio/scene';
import type { CameraNode } from '@mujoco-studio/types';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';

import { rotationFromMatrix, threePosition } from '@/lib/editor/runtimeTransforms';
import { constraintForLock } from '@/lib/editor/transformInteraction';
import type { TransformCommit } from '@/lib/editor/viewportTypes';
import { useEditorStore } from '@/lib/store/editorStore';

import { TransformGizmo } from './ViewportTransformGizmo';
import { useTransformDrag } from './useTransformDrag';

function AuthoredCameraMarker({
  node,
  selected,
  selectionOrder,
  registerGroup,
  isDragging,
  onBeginEdit,
  onBeginDrag,
}: {
  node: CameraNode;
  selected: boolean;
  selectionOrder: string[];
  registerGroup: (id: string, group: THREE.Group | null) => void;
  isDragging: (id: string) => boolean;
  onBeginEdit: (id: string) => void;
  onBeginDrag: (node: CameraNode, event: ThreeEvent<PointerEvent>) => void;
}) {
  const { getSimulation } = usePhysics();
  const select = useEditorStore((state) => state.select);
  const editingId = useEditorStore((state) => state.editingId);
  const groupRef = useRef<THREE.Group>(null);
  const editing = editingId === node.id;

  useFrame(() => {
    const simulation = getSimulation();
    const group = groupRef.current;
    if (!group || !simulation || isDragging(node.id)) return;
    group.position.copy(threePosition(simulation.cameraPositions, node.mjIndex));
    group.quaternion.copy(rotationFromMatrix(simulation.cameraRotations, node.mjIndex));
  });

  return (
    <>
      <group
        ref={(group) => {
          groupRef.current = group;
          registerGroup(node.id, group);
        }}
        userData={{ authoredCamera: node.id }}
        onClick={(event) => {
          event.stopPropagation();
          select(node.id, {
            additive: event.metaKey || event.ctrlKey,
            range: event.shiftKey ? selectionOrder : undefined,
          });
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onBeginEdit(node.id);
        }}
        onPointerDown={(event) => {
          if (!editing || event.button !== 0) return;
          event.stopPropagation();
          onBeginDrag(node, event);
        }}
      >
        <mesh userData={{ authoredCamera: node.id }}>
          <boxGeometry
            args={[selected ? 0.18 : 0.13, selected ? 0.12 : 0.09, selected ? 0.12 : 0.08]}
          />
          <meshBasicMaterial color={selected ? '#ff8a3d' : '#4cc4e0'} wireframe />
        </mesh>
        <mesh
          position={[0, 0, -0.1]}
          rotation={[Math.PI / 2, 0, 0]}
          userData={{ authoredCamera: node.id }}
        >
          <coneGeometry args={[selected ? 0.1 : 0.07, 0.16, 4]} />
          <meshBasicMaterial color={selected ? '#ff8a3d' : '#4cc4e0'} wireframe />
        </mesh>
      </group>
    </>
  );
}

export function AuthoredCameraMarkers({
  onBeginEdit,
  onInteractionChange,
  onTransformCommit,
}: {
  onBeginEdit: (id: string) => void;
  onInteractionChange: (active: boolean) => void;
  onTransformCommit: (commit: TransformCommit) => void;
}) {
  const { graph } = usePhysics();
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const editingId = useEditorStore((state) => state.editingId);
  const editTool = useEditorStore((state) => state.editTool);
  const transformMode = useEditorStore((state) => state.transformMode);
  const groups = useRef(new Map<string, THREE.Group>());
  // Cameras have no size to scale; the scale tool moves them instead.
  const mode = transformMode === 'scale' ? 'translate' : transformMode;
  const { begin, dragRef, activeConstraint } = useTransformDrag({
    onPreview: (node, _delta, current) => {
      const group = groups.current.get(node.id);
      if (group) current.decompose(group.position, group.quaternion, group.scale);
    },
    onFinish: (node) => groups.current.get(node.id)?.scale.setScalar(1),
    onCommit: onTransformCommit,
    onInteractionChange,
  });

  if (!graph) return null;
  const cameras = graph.order
    .map((id) => graph.nodes[id])
    .filter((node): node is CameraNode => node.kind === 'camera');
  const editingCamera = cameras.find((node) => node.id === editingId) ?? null;

  return (
    <group rotation={[MUJOCO_ROOT_ROTATION_X, 0, 0]}>
      {cameras.map((node) => (
        <AuthoredCameraMarker
          key={node.id}
          node={node}
          selected={selectedIds.includes(node.id)}
          selectionOrder={graph.order}
          registerGroup={(id, group) => {
            if (group) groups.current.set(id, group);
            else groups.current.delete(id);
          }}
          isDragging={(id) => dragRef.current?.node.id === id}
          onBeginEdit={onBeginEdit}
          onBeginDrag={(target, event) =>
            begin(
              target,
              mode,
              constraintForLock(useEditorStore.getState().transformAxis),
              event.nativeEvent,
            )
          }
        />
      ))}
      {editingCamera && editTool === 'transform' && (
        <TransformGizmo
          node={editingCamera}
          mode={mode}
          drag={dragRef}
          activeConstraint={activeConstraint}
          onGrab={(constraint, event) => begin(editingCamera, mode, constraint, event.nativeEvent)}
        />
      )}
    </group>
  );
}
