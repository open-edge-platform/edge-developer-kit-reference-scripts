// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { usePhysics } from '@mujoco-studio/mujoco';
import { MUJOCO_ROOT_ROTATION_X } from '@mujoco-studio/scene';
import type { CameraNode, SceneGraph } from '@mujoco-studio/types';
import { GeomType } from '@mujoco-studio/types';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

import { Button } from '@mujoco-studio/ui';
import type { BoxFace } from '@/lib/editor/document';
import { MUJOCO_TO_THREE, rotationFromMatrix, threePosition } from '@/lib/editor/runtimeTransforms';
import { isCameraVisibleGeom } from '@/lib/editor/sceneGraph';
import type { QuaternionTuple, Vec3Tuple } from '@/lib/editor/splatCollision';
import { BLACK } from '@/lib/editor/viewportGeometry';
import { viewportTextures } from '@/lib/editor/viewportTextures';
import type { GeomEntry } from '@/lib/editor/viewportTypes';

import { SplatEnvironment, type SplatEnvironmentStatus } from './SplatEnvironment';
import { AuthoredSceneLighting } from './ViewportLighting';
import { GeomMaterials } from './ViewportMaterials';
import { useSimulationGeomEntries, useSimulationGeomTransforms } from './useSimulationGeoms';

function CameraPreviewGeoms({
  entries,
  graph,
  meshRefs,
  textureUrlsByMaterial,
  textureUrlsByGeom,
  textureFaceByGeom,
  hideGroundPlanes,
}: {
  entries: GeomEntry[];
  graph: SceneGraph | null;
  meshRefs: React.MutableRefObject<Map<number, THREE.Mesh>>;
  textureUrlsByMaterial: Record<string, string>;
  textureUrlsByGeom: Record<string, string>;
  textureFaceByGeom: Record<string, BoxFace>;
  /** Hide MuJoCo ground planes, which would otherwise cover a ready splat backdrop. */
  hideGroundPlanes: boolean;
}) {
  if (!graph) return null;

  return (
    <group rotation={[MUJOCO_ROOT_ROTATION_X, 0, 0]}>
      {entries.map(({ node, geometry }) => {
        const [r, g, b, a] = node.rgba;
        const textureUrl =
          textureUrlsByGeom[node.id] ??
          (node.materialName ? textureUrlsByMaterial[node.materialName] : null);
        const textureFace = textureFaceByGeom[node.id] ?? null;

        return (
          <mesh
            key={node.id}
            userData={{ nodeId: node.id }}
            visible={
              isCameraVisibleGeom(node) && !(hideGroundPlanes && node.geomType === GeomType.Plane)
            }
            matrixAutoUpdate={false}
            castShadow={node.geomType !== GeomType.Plane}
            receiveShadow
            ref={(mesh) => {
              if (mesh) meshRefs.current.set(node.mjIndex, mesh);
              else meshRefs.current.delete(node.mjIndex);
            }}
          >
            <primitive object={geometry} attach="geometry" />
            <GeomMaterials
              color={new THREE.Color(r, g, b)}
              emissive={BLACK}
              opacity={a}
              side={node.geomType === GeomType.Plane ? THREE.DoubleSide : THREE.FrontSide}
              geomType={node.geomType}
              textureUrl={textureUrl}
              textureFace={textureFace}
              rawTexture
            />
          </mesh>
        );
      })}
    </group>
  );
}

/**
 * MuJoCo's headlight: an ambient term plus a directional light along the camera's view. MuJoCo
 * shades `albedo * (ambient + diffuse * cos)` with no tone mapping, which three.js matches with
 * `flat linear` rendering and intensities scaled by pi (its Lambert BRDF divides by pi).
 */
function MujocoHeadlight() {
  const { getSimulation } = usePhysics();
  const get = useThree((state) => state.get);
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const forward = useRef(new THREE.Vector3());

  useFrame(() => {
    const simulation = getSimulation();
    const ambient = ambientRef.current;
    const light = lightRef.current;
    if (!simulation || !ambient || !light) return;
    const headlight = simulation.model.vis.headlight;
    const active = headlight.active !== 0;
    const ambientColor = headlight.ambient as ArrayLike<number>;
    const diffuseColor = headlight.diffuse as ArrayLike<number>;
    ambient.color.setRGB(ambientColor[0], ambientColor[1], ambientColor[2]);
    ambient.intensity = active ? Math.PI : 0;
    light.color.setRGB(diffuseColor[0], diffuseColor[1], diffuseColor[2]);
    light.intensity = active ? Math.PI : 0;
    const camera = get().camera;
    camera.getWorldDirection(forward.current);
    light.position.copy(camera.position);
    light.target.position.copy(camera.position).add(forward.current);
    light.target.updateMatrixWorld();
  });

  return (
    <>
      <ambientLight ref={ambientRef} />
      <directionalLight ref={lightRef} />
    </>
  );
}

/** What a camera view looks through: an authored scene camera, or a free eye and target. */
export type CameraView =
  | { kind: 'camera'; node: CameraNode }
  | { kind: 'free'; position: Vec3Tuple; target: Vec3Tuple; fovy: number };

/** Scene content shared by the camera preview and camera captures. */
export interface CameraSceneProps {
  textureUrlsByMaterial: Record<string, string>;
  textureUrlsByGeom: Record<string, string>;
  textureFaceByGeom: Record<string, BoxFace>;
  splatSrc?: string | null;
  splatOrigin?: Vec3Tuple | null;
  splatScale?: number;
  splatRotation?: QuaternionTuple;
}

const freeEye = new THREE.Vector3();
const freeTarget = new THREE.Vector3();

function CameraPreviewScene({
  view,
  hideSplat = false,
  onSplatStatus,
  textureUrlsByMaterial,
  textureUrlsByGeom,
  textureFaceByGeom,
  splatSrc,
  splatOrigin,
  splatScale,
  splatRotation,
}: CameraSceneProps & {
  view: CameraView;
  hideSplat?: boolean;
  onSplatStatus?: (status: SplatEnvironmentStatus) => void;
}) {
  const [splatStatus, setSplatStatus] = useState<SplatEnvironmentStatus>('idle');
  const showSplat = Boolean(splatSrc) && !hideSplat;
  const get = useThree((state) => state.get);
  const { entries, getSimulation, graph } = useSimulationGeomEntries();
  const meshRefs = useRef(new Map<number, THREE.Mesh>());

  useSimulationGeomTransforms(meshRefs, null, false);

  useFrame(() => {
    const camera = get().camera;
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const simulation = getSimulation();
    if (!simulation) return;

    if (view.kind === 'camera') {
      const index = view.node.mjIndex;
      camera.position.copy(
        threePosition(simulation.cameraPositions, index).applyQuaternion(MUJOCO_TO_THREE),
      );
      camera.quaternion.copy(
        rotationFromMatrix(simulation.cameraRotations, index).premultiply(MUJOCO_TO_THREE),
      );
      camera.fov = view.node.fovy;
    } else {
      // MuJoCo is Z-up; in the rotated three.js frame its +Z is +Y, the default camera up. Looking
      // nearly straight up or down, image up is world +Y instead, as add_camera does.
      const [dx, dy, dz] = view.target.map((value, axis) => value - view.position[axis]);
      const vertical = Math.abs(dz) > 0.98 * Math.hypot(dx, dy, dz);
      camera.position.copy(freeEye.fromArray(view.position).applyQuaternion(MUJOCO_TO_THREE));
      if (vertical) camera.up.set(0, 1, 0).applyQuaternion(MUJOCO_TO_THREE);
      else camera.up.set(0, 1, 0);
      camera.lookAt(freeTarget.fromArray(view.target).applyQuaternion(MUJOCO_TO_THREE));
      camera.fov = view.fovy;
    }
    const clipping = simulation.cameraClipping;
    camera.near = clipping.near;
    camera.far = clipping.far;
    camera.updateProjectionMatrix();
  });

  return (
    <>
      {/* Native renders clear to black and are lit only by the headlight and authored lights. */}
      <color attach="background" args={['#000000']} />
      <MujocoHeadlight />
      <CameraPreviewGeoms
        entries={entries}
        graph={graph}
        meshRefs={meshRefs}
        textureUrlsByMaterial={textureUrlsByMaterial}
        textureUrlsByGeom={textureUrlsByGeom}
        textureFaceByGeom={textureFaceByGeom}
        hideGroundPlanes={showSplat && splatStatus === 'ready'}
      />
      {showSplat && splatSrc && (
        <group rotation={[MUJOCO_ROOT_ROTATION_X, 0, 0]}>
          <SplatEnvironment
            src={splatSrc}
            scale={splatScale}
            rotation={splatRotation}
            fallbackOrigin={splatOrigin}
            onStatusChange={(status) => {
              setSplatStatus(status);
              onSplatStatus?.(status);
            }}
          />
        </group>
      )}
      <AuthoredSceneLighting showHelpers={false} mujocoParity />
    </>
  );
}

export function CameraPreviewWindow({
  cameraId,
  onClose,
  textureUrlsByMaterial,
  textureUrlsByGeom,
  textureFaceByGeom,
  splatSrc,
  splatOrigin,
  splatScale,
  splatRotation,
}: {
  cameraId: string;
  onClose: () => void;
  textureUrlsByMaterial: Record<string, string>;
  textureUrlsByGeom: Record<string, string>;
  textureFaceByGeom: Record<string, BoxFace>;
  splatSrc?: string | null;
  splatOrigin?: Vec3Tuple | null;
  splatScale?: number;
  splatRotation?: QuaternionTuple;
}) {
  const { graph, getSimulation } = usePhysics();
  const node = graph?.nodes[cameraId];
  if (!node || node.kind !== 'camera') return null;
  const size = getSimulation()?.cameraOutputSize(node.mjIndex) ?? { width: 4, height: 3 };

  return (
    <section
      data-testid="camera-preview-window"
      aria-label={`Camera preview: ${node.name}`}
      className="absolute bottom-3 left-3 z-20 flex h-64 w-80 max-w-[calc(100%-1.5rem)] flex-col border border-border bg-surface shadow-2xl"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0 px-3 pt-2">
          <span className="block truncate text-xs font-medium text-foreground">{node.name}</span>
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted">Camera preview</span>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="mr-2 mt-1 shrink-0"
          onClick={onClose}
          title="Close camera preview"
          aria-label="Close camera preview"
        >
          <X />
        </Button>
      </div>
      <div
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden border-t border-border bg-[#111821] [container-type:size]"
        title={`${size.width} x ${size.height}, as recorded`}
      >
        {/* Same shape as the recorded image, so the preview shows exactly what is captured. */}
        <div
          data-testid="camera-preview-canvas"
          className="relative"
          style={{
            aspectRatio: `${size.width} / ${size.height}`,
            width: `min(100cqw, 100cqh * ${size.width / size.height})`,
          }}
          role="img"
          aria-label={`${node.name} camera preview`}
        >
          <Canvas
            className="size-full"
            dpr={[1, 2]}
            flat
            linear
            camera={{ position: [0, 0, 1], fov: 45, near: 0.01, far: 50 }}
          >
            <CameraPreviewScene
              view={{ kind: 'camera', node }}
              textureUrlsByMaterial={textureUrlsByMaterial}
              textureUrlsByGeom={textureUrlsByGeom}
              textureFaceByGeom={textureFaceByGeom}
              splatSrc={splatSrc}
              splatOrigin={splatOrigin}
              splatScale={splatScale}
              splatRotation={splatRotation}
            />
          </Canvas>
        </div>
      </div>
    </section>
  );
}

export interface CameraCaptureRequest {
  id: string;
  view: CameraView;
  width: number;
  height: number;
  hideSplat: boolean;
}

export type CameraCaptureResult =
  { dataUrl: string; splat: 'none' | 'hidden' | 'shown' | 'failed' } | { error: string };

/** Renders frames until textures and the splat have settled, then reads the canvas once. */
function CaptureWhenReady({
  waitForSplat,
  onCapture,
}: {
  waitForSplat: boolean;
  onCapture: (dataUrl: string) => void;
}) {
  const gl = useThree((state) => state.gl);
  const waitRef = useRef(waitForSplat);
  const onCaptureRef = useRef(onCapture);
  const progress = useRef({ frames: 0, settledAt: -1, requested: false, done: false });
  useEffect(() => {
    waitRef.current = waitForSplat;
    onCaptureRef.current = onCapture;
  }, [waitForSplat, onCapture]);

  useFrame(() => {
    const state = progress.current;
    state.frames += 1;
    // Materials acquire their textures once mounted, so start waiting after a few frames.
    if (state.frames === 3 && !state.requested) {
      state.requested = true;
      viewportTextures.settled().then(() => {
        state.settledAt = state.frames;
      });
    }
    if (state.done || state.settledAt < 0 || waitRef.current) return;
    // A few more frames let loaded textures and the splat reach the drawing buffer.
    if (state.frames < state.settledAt + 4) return;
    state.done = true;
    // useFrame runs before this frame renders; preserveDrawingBuffer keeps the previous one.
    onCaptureRef.current(gl.domElement.toDataURL('image/png'));
  });
  return null;
}

/**
 * An off-screen camera render for agents (MCP `render_camera`): the camera preview's scene and
 * MuJoCo-parity shading at an exact pixel size, so the image matches native recordings.
 */
export function CameraCapture({
  request,
  onDone,
  ...scene
}: CameraSceneProps & {
  request: CameraCaptureRequest;
  onDone: (id: string, result: CameraCaptureResult) => void;
}) {
  const [splatStatus, setSplatStatus] = useState<SplatEnvironmentStatus>('idle');
  const wantsSplat = Boolean(scene.splatSrc) && !request.hideSplat;
  const splatSettled = splatStatus === 'ready' || splatStatus === 'error';
  const splat = !scene.splatSrc
    ? 'none'
    : request.hideSplat
      ? 'hidden'
      : splatStatus === 'error'
        ? 'failed'
        : 'shown';

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed top-0"
      style={{ left: -10_000, width: request.width, height: request.height }}
    >
      <Canvas
        key={request.id}
        className="size-full"
        dpr={1}
        flat
        linear
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        camera={{ position: [0, 0, 1], fov: 45, near: 0.01, far: 50 }}
      >
        <CameraPreviewScene
          {...scene}
          view={request.view}
          hideSplat={request.hideSplat}
          onSplatStatus={setSplatStatus}
        />
        <CaptureWhenReady
          waitForSplat={wantsSplat && !splatSettled}
          onCapture={(dataUrl) => onDone(request.id, { dataUrl, splat })}
        />
      </Canvas>
    </div>
  );
}
