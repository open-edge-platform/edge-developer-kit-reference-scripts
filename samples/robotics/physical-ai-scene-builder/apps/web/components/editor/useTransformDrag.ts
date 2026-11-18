// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { usePhysics } from '@mujoco-studio/mujoco';
import type { BodyNode, CameraNode, GeomNode } from '@mujoco-studio/types';
import { useThree } from '@react-three/fiber';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as THREE from 'three';

import { matrixFromRuntime, MUJOCO_TO_THREE } from '@/lib/editor/runtimeTransforms';
import {
  constraintForLock,
  createTransformSession,
  isIdentityDelta,
  type DragConstraint,
  type TransformMode,
  type TransformSession,
} from '@/lib/editor/transformInteraction';
import { commitSceneMatrix } from '@/lib/editor/viewportGeometry';
import type { TransformCommit } from '@/lib/editor/viewportTypes';
import { useEditorStore } from '@/lib/store/editorStore';

export type TransformDragNode = BodyNode | GeomNode | CameraNode;

export interface ActiveTransformDrag {
  node: TransformDragNode;
  mode: TransformMode;
  constraint: DragConstraint;
  /** Scene-frame matrix of the node when the drag started. */
  targetMatrix: THREE.Matrix4;
  /** Scene-frame matrix of the node with the current drag applied. */
  currentMatrix: THREE.Matrix4;
  /** Scene-frame delta (current = delta * target). */
  delta: THREE.Matrix4;
}

interface DragInternals extends ActiveTransformDrag {
  pointerId: number;
  startPointer: THREE.Vector2;
  lastPointer: THREE.Vector2;
  invertSnap: boolean;
  session: TransformSession;
  rebuild: (constraint: DragConstraint) => void;
}

export interface TransformDragOptions {
  /** Called once when a drag starts, before the first preview. */
  onStart?: (node: TransformDragNode) => void;
  /**
   * Rotate/scale pivot in the node's own frame; null (or omitted) pivots at the node origin. Must
   * match the gizmo's `pivotOffset` so the rings sit where the rotation happens.
   */
  pivotOffset?: (node: TransformDragNode) => THREE.Vector3 | null;
  /** Show the drag on screen (the authored document is untouched until the drag ends). */
  onPreview: (node: TransformDragNode, delta: THREE.Matrix4, current: THREE.Matrix4) => void;
  /** Called when the drag ends or is cancelled, before any commit. */
  onFinish?: (node: TransformDragNode) => void;
  onCommit: (commit: TransformCommit) => void;
  onInteractionChange: (active: boolean) => void;
}

const AXIS_KEYS = new Set(['x', 'y', 'z']);

function isTextInput(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * One interaction model for every viewport transform: gizmo handles and direct object drags both
 * start a session here. While dragging: X/Y/Z switch the axis lock, Ctrl/Cmd inverts snapping,
 * S toggles snapping, and Esc or a right click cancels.
 */
export function useTransformDrag(options: TransformDragOptions) {
  const get = useThree((state) => state.get);
  const { graph, getSimulation, isRunning, pause } = usePhysics();
  const optionsRef = useRef(options);
  const dragRef = useRef<DragInternals | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [activeConstraint, setActiveConstraint] = useState<DragConstraint | null>(null);

  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  const begin = useCallback(
    (
      node: TransformDragNode,
      mode: TransformMode,
      constraint: DragConstraint,
      event: PointerEvent,
    ): boolean => {
      const simulation = getSimulation();
      if (!simulation || !graph || event.button !== 0 || dragRef.current) return false;
      const { camera, gl, controls } = get();
      const canvas = gl.domElement;
      const pointerAt = (source: { clientX: number; clientY: number }) => {
        const bounds = canvas.getBoundingClientRect();
        return new THREE.Vector2(source.clientX - bounds.left, source.clientY - bounds.top);
      };
      if (isRunning) pause();
      // Whole objects scale uniformly: axis handles and locks act like the centre handle.
      const uniformScale = mode === 'scale' && node.kind === 'body';
      if (uniformScale) constraint = constraintForLock(null);

      const targetMatrix = matrixFromRuntime(simulation, node);
      const pivotOffset = optionsRef.current.pivotOffset?.(node) ?? null;
      const pivot = pivotOffset
        ? pivotOffset.clone().applyMatrix4(targetMatrix)
        : new THREE.Vector3().setFromMatrixPosition(targetMatrix);
      const rotation = new THREE.Quaternion().setFromRotationMatrix(targetMatrix);
      const startPointer = pointerAt(event);
      const createSession = (nextConstraint: DragConstraint) => {
        const bounds = canvas.getBoundingClientRect();
        return createTransformSession({
          mode,
          constraint: nextConstraint,
          space: useEditorStore.getState().transformSpace,
          pivot,
          rotation,
          sceneToWorld: MUJOCO_TO_THREE,
          camera,
          viewport: { width: bounds.width, height: bounds.height },
          pointer: startPointer,
        });
      };

      const drag: DragInternals = {
        node,
        mode,
        constraint,
        targetMatrix,
        currentMatrix: targetMatrix.clone(),
        delta: new THREE.Matrix4(),
        pointerId: event.pointerId,
        startPointer,
        lastPointer: startPointer.clone(),
        invertSnap: event.ctrlKey || event.metaKey,
        session: createSession(constraint),
        rebuild: (nextConstraint) => {
          drag.constraint = nextConstraint;
          drag.session = createSession(nextConstraint);
          setActiveConstraint(nextConstraint);
        },
      };
      dragRef.current = drag;

      const controlsLike = controls as { enabled?: boolean } | null;
      if (controlsLike) controlsLike.enabled = false;

      const apply = () => {
        const current = dragRef.current;
        if (!current) return;
        const snap = useEditorStore.getState().snap !== current.invertSnap;
        const { delta, feedback } = current.session.update(current.lastPointer, snap);
        current.delta.copy(delta);
        current.currentMatrix.multiplyMatrices(delta, current.targetMatrix);
        optionsRef.current.onPreview(current.node, current.delta, current.currentMatrix);
        useEditorStore.getState().setTransformFeedback(feedback);
        get().invalidate();
      };

      const finish = (commit: boolean) => {
        const current = dragRef.current;
        if (!current) return;
        dragRef.current = null;
        cleanupRef.current?.();
        cleanupRef.current = null;
        setActiveConstraint(null);
        useEditorStore.getState().setTransformFeedback(null);
        if (controlsLike) controlsLike.enabled = true;
        optionsRef.current.onFinish?.(current.node);
        optionsRef.current.onInteractionChange(false);
        const latestSimulation = getSimulation();
        if (commit && latestSimulation && !isIdentityDelta(current.delta)) {
          commitSceneMatrix(
            latestSimulation,
            graph,
            current.node,
            current.mode,
            current.currentMatrix,
            pivotOffset && current.mode !== 'translate'
              ? (commit) => optionsRef.current.onCommit({ ...commit, pivoted: true })
              : optionsRef.current.onCommit,
          );
        }
        get().invalidate();
      };

      const onPointerMove = (moveEvent: PointerEvent) => {
        const current = dragRef.current;
        if (!current || moveEvent.pointerId !== current.pointerId) return;
        current.lastPointer = pointerAt(moveEvent);
        current.invertSnap = moveEvent.ctrlKey || moveEvent.metaKey;
        apply();
      };
      const onPointerUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== dragRef.current?.pointerId || upEvent.button !== 0) return;
        finish(true);
      };
      const onPointerCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId === dragRef.current?.pointerId) finish(false);
      };
      const onPointerDown = (downEvent: PointerEvent) => {
        if (downEvent.button !== 2) return;
        downEvent.preventDefault();
        downEvent.stopPropagation();
        finish(false);
      };
      const onContextMenu = (menuEvent: MouseEvent) => menuEvent.preventDefault();
      const onKey = (keyEvent: KeyboardEvent) => {
        const current = dragRef.current;
        if (!current || isTextInput(keyEvent.target)) return;
        if (keyEvent.key === 'Control' || keyEvent.key === 'Meta') {
          current.invertSnap = keyEvent.type === 'keydown';
          apply();
          return;
        }
        if (keyEvent.type !== 'keydown') return;
        if (keyEvent.key === 'Escape') {
          keyEvent.preventDefault();
          keyEvent.stopPropagation();
          finish(false);
          return;
        }
        const key = keyEvent.key.toLowerCase();
        if (AXIS_KEYS.has(key) && !keyEvent.ctrlKey && !keyEvent.metaKey && !keyEvent.altKey) {
          keyEvent.preventDefault();
          keyEvent.stopPropagation();
          if (uniformScale) return;
          const store = useEditorStore.getState();
          store.toggleTransformAxis(key as 'x' | 'y' | 'z');
          current.rebuild(constraintForLock(useEditorStore.getState().transformAxis));
          apply();
        }
      };
      // Re-evaluate when snapping is toggled from the keyboard or the panel mid-drag.
      const unsubscribe = useEditorStore.subscribe((state, previous) => {
        if (state.snap !== previous.snap) apply();
      });

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);
      window.addEventListener('pointerdown', onPointerDown, { capture: true });
      window.addEventListener('contextmenu', onContextMenu, { capture: true });
      // Capture phase so Escape/X/Y/Z reach the drag before the editor's global shortcuts.
      window.addEventListener('keydown', onKey, { capture: true });
      window.addEventListener('keyup', onKey, { capture: true });
      cleanupRef.current = () => {
        unsubscribe();
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerCancel);
        window.removeEventListener('pointerdown', onPointerDown, { capture: true });
        window.removeEventListener('contextmenu', onContextMenu, { capture: true });
        window.removeEventListener('keydown', onKey, { capture: true });
        window.removeEventListener('keyup', onKey, { capture: true });
      };

      setActiveConstraint(constraint);
      optionsRef.current.onInteractionChange(true);
      optionsRef.current.onStart?.(node);
      return true;
    },
    [get, getSimulation, graph, isRunning, pause],
  );

  // Abandon an in-flight drag if the component goes away (scene reload, edit ended).
  useEffect(
    () => () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      cleanupRef.current?.();
      cleanupRef.current = null;
      useEditorStore.getState().setTransformFeedback(null);
      optionsRef.current.onInteractionChange(false);
      const controls = get().controls as { enabled?: boolean } | null;
      if (controls) controls.enabled = true;
    },
    [get],
  );

  return {
    begin,
    dragRef: dragRef as React.RefObject<ActiveTransformDrag | null>,
    activeConstraint,
  };
}
