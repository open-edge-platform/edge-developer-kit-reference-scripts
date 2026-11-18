// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { usePhysics } from '@mujoco-studio/mujoco';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useRef, useState } from 'react';
import * as THREE from 'three';

import { matrixFromRuntime } from '@/lib/editor/runtimeTransforms';
import {
  AXES,
  axisVector,
  constraintBasis,
  constraintsEqual,
  directionTowardCamera,
  worldUnitsPerPixel,
  type AxisName,
  type DragConstraint,
  type TransformMode,
} from '@/lib/editor/transformInteraction';
import { useEditorStore } from '@/lib/store/editorStore';

import type { ActiveTransformDrag, TransformDragNode } from './useTransformDrag';

/** Gizmo radius / arrow length on screen, in CSS pixels. */
export const GIZMO_SIZE_PX = 110;

export const AXIS_COLORS: Record<AxisName, string> = {
  x: '#ff5a6a',
  y: '#5ad07a',
  z: '#4c9bff',
};
const HIGHLIGHT = '#ffd25a';
const NEUTRAL = '#dfe3ea';

/** Thin visible shapes and fat invisible pickers share these dimensions (gizmo units). */
const SHAFT = new THREE.CylinderGeometry(0.012, 0.012, 1, 8).translate(0, 0.5, 0);
const SHAFT_PICKER = new THREE.CylinderGeometry(0.075, 0.075, 1.1, 6).translate(0, 0.55, 0);
const CONE = new THREE.ConeGeometry(0.05, 0.16, 16).translate(0, 0.92, 0);
const CUBE = new THREE.BoxGeometry(0.1, 0.1, 0.1).translate(0, 0.92, 0);
const PLANE = new THREE.PlaneGeometry(0.22, 0.22);
const PLANE_PICKER = new THREE.PlaneGeometry(0.3, 0.3);
const CENTER = new THREE.SphereGeometry(0.07, 16, 12);
const CENTER_CUBE = new THREE.BoxGeometry(0.13, 0.13, 0.13);
const CENTER_PICKER = new THREE.SphereGeometry(0.13, 12, 8);
const RING = new THREE.TorusGeometry(1, 0.012, 8, 128);
const RING_PICKER = new THREE.TorusGeometry(1, 0.075, 6, 64);
const VIEW_RING = new THREE.TorusGeometry(1.22, 0.01, 8, 128);
const VIEW_RING_PICKER = new THREE.TorusGeometry(1.22, 0.07, 6, 64);

/** Rotations that turn +Y (shafts) toward each axis. */
const SHAFT_ROTATION: Record<AxisName, [number, number, number]> = {
  x: [0, 0, -Math.PI / 2],
  y: [0, 0, 0],
  z: [Math.PI / 2, 0, 0],
};
/** Rotations that turn the XY plane (rings, plane handles) to face each axis. */
const NORMAL_ROTATION: Record<AxisName, [number, number, number]> = {
  x: [0, Math.PI / 2, 0],
  y: [Math.PI / 2, 0, 0],
  z: [0, 0, 0],
};
const PLANE_OFFSET: Record<AxisName, [number, number, number]> = {
  x: [0, 0.3, 0.3],
  y: [0.3, 0, 0.3],
  z: [0.3, 0.3, 0],
};

const AXIS_HIDE_DOT = 0.97;
const PLANE_HIDE_DOT = 0.15;

function GizmoMaterial({ color, opacity = 1 }: { color: string; opacity?: number }) {
  return (
    <meshBasicMaterial
      color={color}
      transparent
      opacity={opacity}
      depthTest={false}
      depthWrite={false}
      toneMapped={false}
      fog={false}
      side={THREE.DoubleSide}
    />
  );
}

interface HandleProps {
  constraint: DragConstraint;
  hovered: DragConstraint | null;
  active: DragConstraint | null;
  onHover: (constraint: DragConstraint | null) => void;
  onGrab: (constraint: DragConstraint, event: ThreeEvent<PointerEvent>) => void;
}

function Picker({
  geometry,
  constraint,
  onHover,
  onGrab,
}: Pick<HandleProps, 'constraint' | 'onHover' | 'onGrab'> & { geometry: THREE.BufferGeometry }) {
  return (
    <mesh
      geometry={geometry}
      visible={false}
      userData={{ transformGizmo: true }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        onGrab(constraint, event);
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        onHover(constraint);
      }}
      onPointerOut={() => onHover(null)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  );
}

function colorFor(
  constraint: DragConstraint,
  base: string,
  hovered: DragConstraint | null,
  active: DragConstraint | null,
) {
  return constraintsEqual(constraint, active) || constraintsEqual(constraint, hovered)
    ? HIGHLIGHT
    : base;
}

/**
 * CAD-style transform gizmo drawn in the MuJoCo (Z-up) scene frame: arrows, plane squares and a
 * free-move center for translate; axis rings plus a view ring for rotate; axis cubes plus a
 * uniform center for scale. Constant size on screen, always drawn on top, colored X red / Y green /
 * Z blue, highlighted on hover and while dragging. The drag itself is handled by
 * `useTransformDrag` through `onGrab`.
 */
export function TransformGizmo({
  node,
  mode,
  drag,
  activeConstraint,
  pivotOffset,
  onGrab,
}: {
  node: TransformDragNode;
  mode: TransformMode;
  drag: React.RefObject<ActiveTransformDrag | null>;
  activeConstraint: DragConstraint | null;
  /** Gizmo center in the node's own frame (same as the drag's `pivotOffset`); default origin. */
  pivotOffset?: (node: TransformDragNode) => THREE.Vector3 | null;
  onGrab: (constraint: DragConstraint, event: ThreeEvent<PointerEvent>) => void;
}) {
  const { getSimulation } = usePhysics();
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const space = useEditorStore((state) => state.transformSpace);
  const lock = useEditorStore((state) => state.transformAxis);
  const [hovered, setHovered] = useState<DragConstraint | null>(null);
  const rootRef = useRef<THREE.Group>(null);
  const axisRefs = useRef(new Map<AxisName, THREE.Object3D>());
  const planeRefs = useRef(new Map<AxisName, THREE.Object3D>());
  const viewRingRef = useRef<THREE.Object3D>(null);

  useFrame(() => {
    const root = rootRef.current;
    const simulation = getSimulation();
    if (!root || !simulation) return;
    const current = drag.current;
    const matrix =
      current && current.node.id === node.id
        ? current.currentMatrix
        : matrixFromRuntime(simulation, node);
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    matrix.decompose(position, rotation, new THREE.Vector3());
    const offset = pivotOffset?.(node);
    if (offset) position.copy(offset).applyMatrix4(matrix);
    root.position.copy(position);
    root.quaternion.copy(constraintBasis(mode, space, rotation));
    root.updateMatrixWorld();

    const worldPosition = new THREE.Vector3().setFromMatrixPosition(root.matrixWorld);
    const worldScale = worldUnitsPerPixel(camera, worldPosition, size.height) * GIZMO_SIZE_PX;
    root.scale.setScalar(worldScale);
    root.updateMatrixWorld();

    // Hide handles that collapse on screen (axis pointing at the viewer, plane seen edge-on).
    const worldRotation = root.getWorldQuaternion(new THREE.Quaternion());
    const toward = directionTowardCamera(camera, worldPosition);
    const dragging = Boolean(current);
    for (const axis of AXES) {
      const facing = Math.abs(axisVector(axis).applyQuaternion(worldRotation).dot(toward));
      const axisObject = axisRefs.current.get(axis);
      if (axisObject) axisObject.visible = dragging || facing < AXIS_HIDE_DOT;
      const planeObject = planeRefs.current.get(axis);
      if (planeObject) planeObject.visible = dragging || facing > PLANE_HIDE_DOT;
    }

    // The view ring always faces the camera.
    const viewRing = viewRingRef.current;
    if (viewRing) {
      viewRing.quaternion.copy(
        worldRotation.clone().invert().multiply(camera.getWorldQuaternion(new THREE.Quaternion())),
      );
    }
  });

  const handle = { hovered, active: activeConstraint, onHover: setHovered, onGrab };
  const shown = (constraint: DragConstraint) => {
    if (activeConstraint) return constraintsEqual(constraint, activeConstraint);
    if (lock) return constraint.kind === 'axis' && constraint.axis === lock;
    return true;
  };
  const trackHandle =
    (kind: 'axis' | 'plane', axis: AxisName) => (object: THREE.Object3D | null) => {
      const refs = kind === 'axis' ? axisRefs.current : planeRefs.current;
      if (object) refs.set(axis, object);
      else refs.delete(axis);
    };

  return (
    <group ref={rootRef} renderOrder={1000} userData={{ editorHelper: true }}>
      {AXES.map((axis) => {
        const constraint: DragConstraint = { kind: 'axis', axis };
        if (!shown(constraint)) return null;
        const color = colorFor(constraint, AXIS_COLORS[axis], hovered, activeConstraint);
        if (mode === 'rotate') {
          return (
            <group key={axis} rotation={NORMAL_ROTATION[axis]}>
              <mesh geometry={RING} renderOrder={1000}>
                <GizmoMaterial color={color} />
              </mesh>
              <Picker geometry={RING_PICKER} constraint={constraint} {...handle} />
            </group>
          );
        }
        return (
          <group key={axis} ref={trackHandle('axis', axis)} rotation={SHAFT_ROTATION[axis]}>
            <mesh geometry={SHAFT} renderOrder={1000}>
              <GizmoMaterial color={color} />
            </mesh>
            <mesh geometry={mode === 'scale' ? CUBE : CONE} renderOrder={1000}>
              <GizmoMaterial color={color} />
            </mesh>
            <Picker geometry={SHAFT_PICKER} constraint={constraint} {...handle} />
          </group>
        );
      })}

      {mode === 'translate' &&
        AXES.map((normal) => {
          const constraint: DragConstraint = { kind: 'plane', normal };
          if (!shown(constraint)) return null;
          const highlighted =
            constraintsEqual(constraint, hovered) || constraintsEqual(constraint, activeConstraint);
          return (
            <group
              key={`plane-${normal}`}
              ref={trackHandle('plane', normal)}
              position={PLANE_OFFSET[normal]}
              rotation={NORMAL_ROTATION[normal]}
            >
              <mesh geometry={PLANE} renderOrder={1000}>
                <GizmoMaterial
                  color={highlighted ? HIGHLIGHT : AXIS_COLORS[normal]}
                  opacity={highlighted ? 0.75 : 0.35}
                />
              </mesh>
              <Picker geometry={PLANE_PICKER} constraint={constraint} {...handle} />
            </group>
          );
        })}

      {shown({ kind: 'view' }) &&
        (mode === 'rotate' ? (
          <group ref={viewRingRef}>
            <mesh geometry={VIEW_RING} renderOrder={1000}>
              <GizmoMaterial
                color={colorFor({ kind: 'view' }, NEUTRAL, hovered, activeConstraint)}
                opacity={0.8}
              />
            </mesh>
            <Picker geometry={VIEW_RING_PICKER} constraint={{ kind: 'view' }} {...handle} />
          </group>
        ) : (
          <group>
            <mesh geometry={mode === 'scale' ? CENTER_CUBE : CENTER} renderOrder={1000}>
              <GizmoMaterial
                color={colorFor({ kind: 'view' }, NEUTRAL, hovered, activeConstraint)}
                opacity={0.9}
              />
            </mesh>
            <Picker geometry={CENTER_PICKER} constraint={{ kind: 'view' }} {...handle} />
          </group>
        ))}
    </group>
  );
}
