// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { usePhysics } from '@mujoco-studio/mujoco';
import { MUJOCO_ROOT_ROTATION_X } from '@mujoco-studio/scene';
import { Grid, GizmoHelper, GizmoViewcube, OrbitControls } from '@react-three/drei';
import {
  Canvas,
  events as createPointerEvents,
  useThree,
  type RootStore,
} from '@react-three/fiber';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { BoxGeometry } from 'three';

import { Button } from '@mujoco-studio/ui';
import type { BoxFace, MeshObjectPlacement } from '@/lib/editor/document';
import type { ViewportCameraPose } from '@/lib/editor/runtimeTransforms';
import type { SplatCleanup } from '@/lib/editor/splatCleanup';
import type { QuaternionTuple, SplatPoint, Vec3Tuple } from '@/lib/editor/splatCollision';
import { prioritizeTransformGizmoHits } from '@/lib/editor/transformInteraction';
import { useEditorStore } from '@/lib/store/editorStore';
import type {
  DraggedAssetPreview,
  FocusRequest,
  MarqueePoint,
  PlacementCandidate,
  TransformCommit,
  ViewportHandle,
} from '@/lib/editor/viewportTypes';

import { SplatEnvironment, type SplatEnvironmentStatus } from './SplatEnvironment';
import { AuthoredCameraMarkers } from './ViewportCameraMarkers';
import { GenerationZone, type GenerationZoneTarget } from './ViewportGenerationZone';
import { CameraPreviewWindow } from './ViewportCameraPreview';
import { AuthoredSceneLighting } from './ViewportLighting';
import { CameraPoseTracker, ViewportNavigation } from './ViewportNavigation';
import { PlacementDropSurface, PlacementPreview } from './ViewportPlacement';
import { SimulationGeoms } from './ViewportSimulationGeoms';
import { TransformReadoutOverlay } from './ViewportTransformGuides';

/** Unit box outlined over drei's view cube (which draws its own faces at the same scale). */
const VIEW_CUBE_BOX = new BoxGeometry(1, 1, 1);

/** Default R3F pointer events, except transform gizmo handles win over the geometry behind them. */
function viewportEvents(store: RootStore) {
  return { ...createPointerEvents(store), filter: prioritizeTransformGizmoHits };
}

const AXIS_LOCK_LABEL = { translate: 'free', rotate: 'view', scale: 'uniform' } as const;

export type { TransformCommit, DraggedAssetPreview, ViewportHandle };
export { CameraPreviewWindow };

export interface ViewportProps {
  /**
   * Stop drawing (a camera capture is rendering). On software rendering a large splat in the main
   * viewport starved captures past their time limit.
   */
  paused?: boolean;
  onTransformCommit: (commit: TransformCommit) => void;
  draggedAsset: DraggedAssetPreview | null;
  onAssetDrop: (placement: MeshObjectPlacement) => void;
  textureUrlsByMaterial: Record<string, string>;
  textureUrlsByGeom: Record<string, string>;
  textureFaceByGeom: Record<string, BoxFace>;
  cameraPoseRef: React.MutableRefObject<ViewportCameraPose | null>;
  onBeginEdit: (id?: string) => void;
  generationPickStage?: 'source' | null;
  generationSourceBody?: string;
  generationPickMessage?: string | null;
  onGenerationBodySelect?: (bodyName: string) => void;
  onCancelGenerationPick?: () => void;
  /** Generate randomization zone to draw and edit on the surface, or null to hide it. */
  generationZone?: GenerationZoneTarget | null;
  splatSrc?: string | null;
  /** Splat placement while its `rs_backdrop` body is missing; otherwise the body pose wins. */
  splatOrigin?: Vec3Tuple | null;
  splatScale?: number;
  /** Calibration rotation from raw PLY to the backdrop body frame ([w, x, y, z]). */
  splatRotation?: QuaternionTuple;
  /** Parts of the scan left out (splatCleanup.ts). */
  splatCleanup?: SplatCleanup;
  onSplatStatusChange?: (status: SplatEnvironmentStatus) => void;
  onSplatLoad?: (points: SplatPoint[]) => void;
  onSplatError?: (error: Error) => void;
}

/** A demand frameloop does not redraw when it resumes from `never`; ask for one frame. */
function RedrawOnResume({ paused }: { paused: boolean }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    if (!paused) invalidate();
  }, [paused, invalidate]);
  return null;
}

export const Viewport = forwardRef<ViewportHandle, ViewportProps>(function Viewport(
  {
    paused = false,
    onTransformCommit,
    draggedAsset,
    onAssetDrop,
    textureUrlsByMaterial,
    textureUrlsByGeom,
    textureFaceByGeom,
    cameraPoseRef,
    onBeginEdit,
    generationPickStage = null,
    generationSourceBody,
    generationPickMessage,
    onGenerationBodySelect,
    onCancelGenerationPick,
    generationZone = null,
    splatSrc = null,
    splatOrigin = null,
    splatScale = 1,
    splatRotation,
    splatCleanup,
    onSplatStatusChange,
    onSplatLoad,
    onSplatError,
  },
  ref,
) {
  const { graph } = usePhysics();
  const helpers = useEditorStore((s) => s.helpers);
  const select = useEditorStore((s) => s.select);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const editingId = useEditorStore((s) => s.editingId);
  const transformAxis = useEditorStore((s) => s.transformAxis);
  const transformMode = useEditorStore((s) => s.transformMode);
  const editTool = useEditorStore((s) => s.editTool);
  const editToolStatus = useEditorStore((s) => s.editToolStatus);
  const [interactionActive, setInteractionActive] = useState(false);
  const [marqueeStart, setMarqueeStart] = useState<MarqueePoint | null>(null);
  const [marqueeEnd, setMarqueeEnd] = useState<MarqueePoint | null>(null);
  const [placementCandidate, setPlacementCandidate] = useState<PlacementCandidate | null>(null);
  const focusRequestRef = useRef<FocusRequest | null>(null);
  const requestFocus = useCallback((ids: readonly string[]) => {
    focusRequestRef.current = { ids: [...ids] };
  }, []);
  const focusSelection = useCallback(
    (ids: readonly string[] = selectedIds) => requestFocus(ids),
    [requestFocus, selectedIds],
  );
  const focusNode = useCallback((id: string) => requestFocus([id]), [requestFocus]);
  const focusAndBeginEdit = useCallback(
    (id: string) => {
      focusNode(id);
      onBeginEdit(id);
    },
    [focusNode, onBeginEdit],
  );

  // Frame the object when the zone editor opens or switches object; zones are only centimetres wide.
  const zoneBody = generationZone?.body ?? null;
  const framedZoneBodyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!zoneBody) {
      framedZoneBodyRef.current = null;
      return;
    }
    if (!graph || framedZoneBodyRef.current === zoneBody) return;
    const id = graph.order.find((nodeId) => {
      const node = graph.nodes[nodeId];
      return node?.kind === 'body' && node.name === zoneBody;
    });
    if (!id) return;
    framedZoneBodyRef.current = zoneBody;
    requestFocus([id]);
  }, [graph, requestFocus, zoneBody]);

  useImperativeHandle(
    ref,
    () => ({
      focusSelection,
      focusNode,
    }),
    [focusNode, focusSelection],
  );

  const activePlacementCandidate =
    draggedAsset && placementCandidate?.assetId === draggedAsset.id ? placementCandidate : null;

  const marqueeStyle =
    marqueeStart && marqueeEnd
      ? {
          left: Math.min(marqueeStart.x, marqueeEnd.x),
          top: Math.min(marqueeStart.y, marqueeEnd.y),
          width: Math.abs(marqueeStart.x - marqueeEnd.x),
          height: Math.abs(marqueeStart.y - marqueeEnd.y),
        }
      : null;

  return (
    <div className="relative h-full">
      <Canvas
        frameloop={paused ? 'never' : 'demand'}
        shadows={helpers.shadows ? 'percentage' : false}
        dpr={[1, 2]}
        events={viewportEvents}
        camera={{ position: [2.4, 1.8, 2.4], fov: 45, near: 0.01, far: 200 }}
        style={
          generationPickStage || (editingId && editTool === 'place-on-object')
            ? { cursor: 'crosshair' }
            : undefined
        }
        onPointerDown={(event) => {
          if (editingId || generationPickStage) return;
          if (!event.shiftKey || event.button !== 0) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
          setMarqueeStart(point);
          setMarqueeEnd(point);
        }}
        onPointerMissed={() => {
          if (!marqueeStart && !editingId && !generationPickStage) select(null);
        }}
      >
        <RedrawOnResume paused={paused} />
        <CameraPoseTracker cameraPoseRef={cameraPoseRef} />
        <ViewportNavigation focusRequestRef={focusRequestRef} />
        <color attach="background" args={['#08090c']} />
        <fog attach="fog" args={['#08090c', 14, 44]} />

        <hemisphereLight args={['#8fb3ff', '#14161c', 1.1]} />
        <directionalLight
          position={[3, 6, 4]}
          intensity={2.2}
          castShadow={helpers.shadows}
          shadow-mapSize={[2048, 2048]}
          shadow-camera-near={0.5}
          shadow-camera-far={30}
          shadow-camera-left={-6}
          shadow-camera-right={6}
          shadow-camera-top={6}
          shadow-camera-bottom={-6}
        />
        <directionalLight position={[-4, 3, -2]} intensity={0.5} color="#6ea8ff" />

        {helpers.grid && (
          <Grid
            userData={{ editorHelper: true }}
            args={[20, 20]}
            cellSize={0.25}
            cellThickness={0.5}
            cellColor="#1c2230"
            sectionSize={1}
            sectionThickness={1}
            sectionColor="#2b3550"
            fadeDistance={30}
            fadeStrength={1.5}
            infiniteGrid
            followCamera={false}
          />
        )}
        {helpers.axes && <axesHelper args={[0.5]} userData={{ editorHelper: true }} />}

        <SimulationGeoms
          onTransformCommit={onTransformCommit}
          marqueeStart={marqueeStart}
          onMarqueeChange={setMarqueeEnd}
          onMarqueeEnd={() => {
            setMarqueeStart(null);
            setMarqueeEnd(null);
          }}
          onFocusAndEdit={focusAndBeginEdit}
          onInteractionChange={setInteractionActive}
          textureUrlsByMaterial={textureUrlsByMaterial}
          textureUrlsByGeom={textureUrlsByGeom}
          textureFaceByGeom={textureFaceByGeom}
          generationPickStage={generationPickStage}
          generationSourceBody={generationSourceBody}
          onGenerationBodySelect={onGenerationBodySelect}
        />
        {generationZone && (
          <GenerationZone target={generationZone} onInteractionChange={setInteractionActive} />
        )}
        <AuthoredSceneLighting />
        <AuthoredCameraMarkers
          onBeginEdit={focusAndBeginEdit}
          onInteractionChange={setInteractionActive}
          onTransformCommit={onTransformCommit}
        />

        {splatSrc && (
          // MuJoCo geoms render inside a MUJOCO_ROOT_ROTATION_X-rotated group (z-up -> three.js
          // y-up); the splat is posed by its MuJoCo body, so it lives in the same frame. Ground
          // planes stay visible here; only the camera preview hides them behind the splat.
          <group rotation={[MUJOCO_ROOT_ROTATION_X, 0, 0]}>
            <SplatEnvironment
              src={splatSrc}
              scale={splatScale}
              rotation={splatRotation}
              cleanup={splatCleanup}
              fallbackOrigin={splatOrigin}
              onStatusChange={onSplatStatusChange}
              onLoad={onSplatLoad}
              onError={onSplatError}
            />
          </group>
        )}
        <PlacementDropSurface
          asset={draggedAsset}
          onPreview={setPlacementCandidate}
          onDrop={onAssetDrop}
        />
        {draggedAsset && activePlacementCandidate && (
          <PlacementPreview
            candidate={activePlacementCandidate}
            dimensions={draggedAsset.dimensions}
          />
        )}

        <OrbitControls
          makeDefault
          enabled={!interactionActive}
          enableDamping
          dampingFactor={0.08}
          target={[0, 0.35, 0]}
        />
        <GizmoHelper alignment="top-right" margin={[72, 72]}>
          {/* CAD-style view cube: light faces, dark labels and edges, accent on hover. drei tints
              the face texture with hoverColor, so faces must be light for hover to show. */}
          <GizmoViewcube
            color="#f3f4f6"
            hoverColor="#ff8a3d"
            textColor="#1a212b"
            strokeColor="#9aa3b2"
            font="700 24px ui-sans-serif, sans-serif"
          />
          <lineSegments scale={60} raycast={() => null}>
            <edgesGeometry args={[VIEW_CUBE_BOX]} />
            <lineBasicMaterial color="#1a212b" />
          </lineSegments>
        </GizmoHelper>
      </Canvas>
      {editingId && (
        <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-2 border border-accent/50 bg-surface/90 px-2.5 py-1.5 text-[11px] shadow-lg">
          <span className="size-1.5 bg-accent" />
          <span className="font-medium text-foreground">
            Editing {graph?.nodes[editingId]?.name ?? 'object'}
          </span>
          <span className="font-mono uppercase text-muted">
            {editTool === 'place-on-object'
              ? 'place on object'
              : `${transformMode} ${transformAxis ?? AXIS_LOCK_LABEL[transformMode]}`}
          </span>
        </div>
      )}
      {editingId && editTool === 'place-on-object' && (
        <div
          className="pointer-events-none absolute top-12 left-3 border border-info/50 bg-surface/90 px-2.5 py-1.5 text-[11px] text-muted shadow-lg"
          aria-live="polite"
        >
          {editToolStatus ?? 'Click an object to place on top'}
        </div>
      )}
      {generationPickStage && (
        <div
          className="pointer-events-auto absolute left-1/2 top-3 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-3 border border-info/60 bg-surface/95 px-3 py-2 text-[11px] shadow-lg"
          role="status"
          aria-live="polite"
          aria-label="Generation mode: select a source object"
        >
          <span className="size-1.5 shrink-0 bg-info" aria-hidden="true" />
          <span className="min-w-0 text-foreground">
            {generationPickMessage ?? 'Select the source object'}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0"
            onClick={onCancelGenerationPick}
            title="Cancel viewport selection"
          >
            Cancel
          </Button>
        </div>
      )}
      <TransformReadoutOverlay />
      {marqueeStyle && (
        <div
          className="pointer-events-none absolute border border-info bg-info/10"
          style={marqueeStyle}
        />
      )}
    </div>
  );
});
