// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { usePhysics } from '@mujoco-studio/mujoco';
import { MUJOCO_ROOT_ROTATION_X } from '@mujoco-studio/scene';
import type { GeomNode } from '@mujoco-studio/types';
import { GeomType } from '@mujoco-studio/types';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useRef, useState } from 'react';
import * as THREE from 'three';

import {
  beginBackdropDragPreview,
  endBackdropDragPreview,
  updateBackdropDragPreview,
} from '@/lib/editor/backdropDragPreview';
import { isSplatBackdropNode, isSplatTableNode, type BoxFace } from '@/lib/editor/document';
import { resolveCenteredPlacement } from '@/lib/editor/placeOnObject';
import { isPlaceableSource } from '@/lib/editor/sceneGraph';
import { constraintForLock } from '@/lib/editor/transformInteraction';
import { useEditorStore } from '@/lib/store/editorStore';
import {
  affectedGeomIndices,
  BLACK,
  commitWorldTranslation,
  GENERATION_SOURCE_EMISSIVE,
  HOVER_EMISSIVE,
  isSelectedGeom,
  owningBodyId,
  placementTargetForGeom,
  SELECTION_EMISSIVE,
  transformTarget,
  transformPivotOffset,
  visibleGeomBoundsForSelection,
} from '@/lib/editor/viewportGeometry';
import type { MarqueePoint, TransformCommit } from '@/lib/editor/viewportTypes';

import { GeomMaterials } from './ViewportMaterials';
import { MarqueeSelection } from './ViewportMarqueeSelection';
import { TransformGizmo } from './ViewportTransformGizmo';
import { TransformGuides } from './ViewportTransformGuides';
import { useSimulationGeomEntries, useSimulationGeomTransforms } from './useSimulationGeoms';
import { useTransformDrag, type TransformDragNode } from './useTransformDrag';

export function SimulationGeoms({
  onTransformCommit,
  marqueeStart,
  onMarqueeChange,
  onMarqueeEnd,
  onFocusAndEdit,
  onInteractionChange,
  textureUrlsByMaterial,
  textureUrlsByGeom,
  textureFaceByGeom,
  generationPickStage,
  generationSourceBody,
  onGenerationBodySelect,
}: {
  onTransformCommit: (commit: TransformCommit) => void;
  marqueeStart: MarqueePoint | null;
  onMarqueeChange: (point: MarqueePoint) => void;
  onMarqueeEnd: () => void;
  onFocusAndEdit: (id: string) => void;
  onInteractionChange: (active: boolean) => void;
  textureUrlsByMaterial: Record<string, string>;
  textureUrlsByGeom: Record<string, string>;
  textureFaceByGeom: Record<string, BoxFace>;
  generationPickStage: 'source' | null;
  generationSourceBody?: string;
  onGenerationBodySelect?: (bodyName: string) => void;
}) {
  const scene = useThree((state) => state.scene);
  const { graph, getSimulation, isRunning, pause } = usePhysics();
  const select = useEditorStore((s) => s.select);
  const hover = useEditorStore((s) => s.hover);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const editingId = useEditorStore((s) => s.editingId);
  const transformAxis = useEditorStore((s) => s.transformAxis);
  const transformMode = useEditorStore((s) => s.transformMode);
  const editTool = useEditorStore((s) => s.editTool);
  const setEditTool = useEditorStore((s) => s.setEditTool);
  const setEditToolStatus = useEditorStore((s) => s.setEditToolStatus);
  const hoveredId = useEditorStore((s) => s.hoveredId);
  const splatTablesVisible = useEditorStore((s) => s.splatTablesVisible);

  const meshRefs = useRef(new Map<number, THREE.Mesh>());
  const initialGeomMatrices = useRef(new Map<number, THREE.Matrix4>());
  const [draggingGeomIndices, setDraggingGeomIndices] = useState<number[] | null>(null);
  const { entries } = useSimulationGeomEntries(meshRefs);
  useSimulationGeomTransforms(meshRefs, draggingGeomIndices, true);
  // Read on demand (drag start, gizmo frame) so the splat pivot never goes stale.
  const pivotOffset = (node: TransformDragNode) => {
    const { splatOrigin, splatCalibration } = useEditorStore.getState();
    return transformPivotOffset(node, splatOrigin, splatCalibration.level);
  };
  const {
    begin: beginDrag,
    dragRef,
    activeConstraint,
  } = useTransformDrag({
    pivotOffset,
    onStart: (node) => {
      if (!graph || node.kind === 'camera') return;
      // The splat follows its backdrop body's runtime pose; feed it the live drag too.
      if (node.kind === 'body' && isSplatBackdropNode(node)) beginBackdropDragPreview(node.id);
      const indices = affectedGeomIndices(graph, node);
      initialGeomMatrices.current.clear();
      for (const index of indices) {
        const mesh = meshRefs.current.get(index);
        if (mesh) initialGeomMatrices.current.set(index, mesh.matrix.clone());
      }
      setDraggingGeomIndices(indices);
    },
    onPreview: (_node, delta) => {
      updateBackdropDragPreview(delta);
      for (const [index, initialMatrix] of initialGeomMatrices.current) {
        const mesh = meshRefs.current.get(index);
        if (!mesh) continue;
        mesh.matrix.multiplyMatrices(delta, initialMatrix);
        mesh.matrixWorldNeedsUpdate = true;
      }
    },
    onFinish: () => {
      endBackdropDragPreview();
      initialGeomMatrices.current.clear();
      setDraggingGeomIndices(null);
    },
    onCommit: onTransformCommit,
    onInteractionChange,
  });

  if (!graph) return null;

  // On the Splat tab a table often sits just under the scanned tabletop, so the invisible scan
  // surface is hit first: pointer events that also hit a table go to the table instead.
  const behindTable = (event: ThreeEvent<MouseEvent | PointerEvent>) =>
    splatTablesVisible &&
    event.intersections.some(({ object }) => {
      const hit = graph.nodes[object.userData.nodeId as string];
      return hit ? isSplatTableNode(hit) : false;
    });

  const gizmoTarget =
    editingId && editTool === 'transform'
      ? transformTarget(graph, [editingId], transformMode)
      : null;

  const handlePlaceOnObjectClick = (event: ThreeEvent<MouseEvent>, node: GeomNode) => {
    event.stopPropagation();
    if (editTool !== 'place-on-object' || !editingId) return;

    const source = transformTarget(graph, [editingId], 'translate');
    if (!source || !isPlaceableSource(graph, source)) {
      setEditToolStatus('The selected object cannot be placed');
      return;
    }

    const target = placementTargetForGeom(graph, node);
    const sourceGeomIndices = new Set(affectedGeomIndices(graph, source));
    if (affectedGeomIndices(graph, target).some((index) => sourceGeomIndices.has(index))) {
      setEditToolStatus('Choose a different object');
      return;
    }

    const simulation = getSimulation();
    if (!simulation) {
      setEditToolStatus('The scene is not ready for placement');
      return;
    }
    if (isRunning) pause();

    const sourceBounds = visibleGeomBoundsForSelection(scene, graph, [source.id]);
    const targetBounds = visibleGeomBoundsForSelection(scene, graph, [target.id]);
    if (!sourceBounds || !targetBounds) {
      setEditToolStatus('Both objects need visible solid geometry');
      return;
    }

    const result = resolveCenteredPlacement(sourceBounds, targetBounds);
    if (!result.ok) {
      setEditToolStatus('Both objects need finite visible bounds');
      return;
    }

    commitWorldTranslation(simulation, graph, source, result.delta, onTransformCommit);
    setEditToolStatus(null);
    setEditTool('transform');
  };

  const handleGenerationBodyClick = (event: ThreeEvent<MouseEvent>, node: GeomNode) => {
    event.stopPropagation();
    if (!generationPickStage || !onGenerationBodySelect) return;
    const bodyId = owningBodyId(graph, node);
    const body = bodyId ? graph.nodes[bodyId] : null;
    onGenerationBodySelect(body?.kind === 'body' ? body.name : '');
  };

  const beginDirectDrag = (event: ThreeEvent<PointerEvent>) => {
    if (editTool === 'place-on-object' || generationPickStage) {
      event.stopPropagation();
      return;
    }
    if (!editingId || event.button !== 0) return;
    const target = transformTarget(graph, [editingId], transformMode);
    if (!target) return;
    const eventNode = graph.nodes[event.eventObject.userData.nodeId as string];
    if (eventNode?.kind !== 'geom' || !isSelectedGeom(graph, eventNode, [editingId])) return;

    event.stopPropagation();
    beginDrag(target, transformMode, constraintForLock(transformAxis), event.nativeEvent);
  };

  return (
    <group rotation={[MUJOCO_ROOT_ROTATION_X, 0, 0]}>
      {entries.map(({ node, geometry }) => {
        // Splat tables are drawn (and pickable) only on the Splat tab; they still collide.
        if (!splatTablesVisible && isSplatTableNode(node)) return null;
        const [r, g, b, a] = node.rgba;
        const bodyId = owningBodyId(graph, node);
        const body = bodyId ? graph.nodes[bodyId] : null;
        const generationEmissive =
          body?.kind === 'body' && body.name === generationSourceBody
            ? GENERATION_SOURCE_EMISSIVE
            : null;
        const emissive = isSelectedGeom(graph, node, selectedIds)
          ? (generationEmissive ?? SELECTION_EMISSIVE)
          : hoveredId === node.id
            ? HOVER_EMISSIVE
            : (generationEmissive ?? BLACK);
        const textureUrl =
          textureUrlsByGeom[node.id] ??
          (node.materialName ? textureUrlsByMaterial[node.materialName] : null);
        const textureFace = textureFaceByGeom[node.id] ?? null;
        // The splat backdrop's heightfield never renders; it stays pickable so clicking the scan
        // selects the backdrop.
        const heightField = isSplatBackdropNode(node);

        return (
          <mesh
            key={node.id}
            userData={{ nodeId: node.id }}
            matrixAutoUpdate={false}
            castShadow={node.geomType !== GeomType.Plane && !heightField}
            receiveShadow
            ref={(mesh) => {
              if (mesh) meshRefs.current.set(node.mjIndex, mesh);
              else meshRefs.current.delete(node.mjIndex);
            }}
            onClick={(event) => {
              if (heightField && behindTable(event)) return;
              event.stopPropagation();
              if (generationPickStage) {
                handleGenerationBodyClick(event, node);
                return;
              }
              if (editTool === 'place-on-object') {
                handlePlaceOnObjectClick(event, node);
                return;
              }
              if (editingId) return;
              select(owningBodyId(graph, node) ?? node.id, {
                additive: event.metaKey || event.ctrlKey,
                range: event.shiftKey ? graph?.order : undefined,
              });
            }}
            onDoubleClick={(event) => {
              if (heightField && behindTable(event)) return;
              event.stopPropagation();
              if (editTool === 'place-on-object' || generationPickStage) return;
              onFocusAndEdit(owningBodyId(graph, node) ?? node.id);
            }}
            onPointerDown={(event) => {
              if (heightField && behindTable(event)) return;
              beginDirectDrag(event);
            }}
            onPointerMove={(event) => {
              if (editTool === 'place-on-object' || generationPickStage) {
                event.stopPropagation();
              }
            }}
            onPointerOver={(event) => {
              if (heightField && behindTable(event)) return;
              event.stopPropagation();
              hover(node.id);
            }}
            onPointerOut={() => hover(null)}
          >
            <primitive object={geometry} attach="geometry" />
            {heightField ? (
              <meshBasicMaterial visible={false} />
            ) : (
              <GeomMaterials
                color={new THREE.Color(r, g, b)}
                emissive={emissive}
                opacity={a}
                side={node.geomType === GeomType.Plane ? THREE.DoubleSide : THREE.FrontSide}
                geomType={node.geomType}
                textureUrl={textureUrl}
                textureFace={textureFace}
              />
            )}
          </mesh>
        );
      })}
      <>
        {gizmoTarget && (
          <TransformGizmo
            node={gizmoTarget}
            mode={transformMode}
            drag={dragRef}
            activeConstraint={activeConstraint}
            pivotOffset={pivotOffset}
            onGrab={(constraint, event) =>
              beginDrag(gizmoTarget, transformMode, constraint, event.nativeEvent)
            }
          />
        )}
        <TransformGuides />
        <MarqueeSelection
          start={marqueeStart}
          graph={graph}
          meshRefs={meshRefs}
          onChange={onMarqueeChange}
          onEnd={onMarqueeEnd}
        />
      </>
    </group>
  );
}
