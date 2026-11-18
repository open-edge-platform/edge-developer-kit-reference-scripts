// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import {
  buildSceneGraph,
  usePhysics,
  type RuntimeFile,
  type Simulation,
} from '@mujoco-studio/mujoco';
import { DEFAULT_SCENE } from '@mujoco-studio/scene';
import { Button, cn, Dialog, useNotice } from '@mujoco-studio/ui';
import {
  SPLAT_BACKDROP_BODY,
  splatFilename,
  splatFormatOf,
  type SceneNodeKind,
} from '@mujoco-studio/types';
import { Copy, FileCode2, LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import { InspectorPanel } from './InspectorPanel';
import { McpPanel } from './McpPanel';
import { mcpAssetSummary } from '@/lib/mcp/assetSummary';
import { applySceneOperations } from '@/lib/mcp/editorOperations';
import type { EditorCommand, RenderCameraResult } from '@/lib/mcp/contracts';
import { FREE_VIEW_SIZE, renderSize, resolveRenderTarget } from '@/lib/mcp/renderCamera';
import { checkScene } from '@/lib/mcp/sceneCheck';
import { detectTables } from '@/lib/mcp/tableDetection';
import {
  bodyDimensions,
  currentWorldBounds,
  planPlacement,
  type PlacementTarget,
} from '@/lib/mcp/objectPlacement';
import { AssetBrowserPanel, type SceneAsset, type SceneAssetArtifact } from './AssetBrowserPanel';
import { AssetPreview, type PreviewableAsset } from './AssetPreview';
import { MjcfPanel } from './MjcfPanel';
import { RobotBrowserPanel } from './RobotBrowserPanel';
import { SplatBrowserPanel } from './SplatBrowserPanel';
import { RevisionPanel } from './RevisionPanel';
import { SceneTree } from './SceneTree';
import { CompactToolbar, type WorkspaceMode } from './CompactToolbar';
import { GenerationPanel, type GenerationPickStage } from './GenerationPanel';
import { EvaluationPanel } from './EvaluationPanel';
import { useEvaluationRuntime } from '@/components/evaluation/EvaluationRuntimeProvider';
import { useTeleoperationRuntime } from '@/components/teleoperation/TeleoperationRuntimeProvider';
import {
  CameraPreviewWindow,
  Viewport,
  type TransformCommit,
  type ViewportHandle,
} from './Viewport';
import {
  CameraCapture,
  type CameraCaptureRequest,
  type CameraCaptureResult,
} from './ViewportCameraPreview';
import { ViewportErrorBoundary } from './ViewportErrorBoundary';
import { ViewportToolStrip } from './ViewportToolStrip';
import { BuildGenerateNotice } from './BuildGenerateNotice';
import { preferredSourceBody, sourceBodiesFromXml } from './generationPanelUtils';
import type { GenerationZoneTarget } from './ViewportGenerationZone';
import { TransformSettings, ViewportSettings } from './WorkspaceSettings';
import {
  applyMaterialToNode,
  compilerAngleUnit,
  scaleObject,
  setObjectFriction,
  setObjectMass,
  insertCamera,
  insertMountedCamera,
  deleteRobotInstance,
  parseCustomGeomDefinition,
  type BoxFace,
  deleteNode,
  duplicateNode,
  insertCustomGeomObject,
  insertLight,
  insertPrimitiveObject,
  insertMeshAsset,
  insertRobotModel,
  hasSplatBackdrop,
  insertSplatBackdrop,
  insertSplatTable,
  SPLAT_TABLE_HALF_SIZE,
  isSplatTableNode,
  shiftWorldElements,
  SPLAT_TABLE_HEIGHT,
  isSplatBackdropNode,
  removeSplatBackdrop,
  splatBackdropBodyPosition,
  splatBackdropHeightfieldMatches,
  materialNameFor,
  robotInstancePrefixForNode,
  setNodeAttribute,
} from '@/lib/editor/document';
import type {
  MeshObjectPlacement,
  PrimitiveObjectPlacement,
  RobotPlacement,
} from '@/lib/editor/document';
import {
  autoLevelCalibration,
  backdropPivot,
  calibrationRotation,
  DEFAULT_SPLAT_CALIBRATION,
  deriveSplatBackdrop,
  detectSplatOrientation,
  levelBackdropPose,
  measureScanSurface,
  recalibratedBodyPosition,
  type QuaternionTuple,
  type SplatCalibration,
  type SplatPoint,
  type Vec3Tuple,
} from '@/lib/editor/splatCollision';
import { objectsInsideTables, simulationSplatTables } from '@/lib/editor/scanTable';
import {
  deleteCachedSplat,
  loadCachedSplat,
  saveCachedSplat,
  shouldCacheSplat,
} from '@/lib/editor/splatCache';
import {
  createScene,
  getRobot,
  listRobotMeshReferences,
  listRobots,
  updateScene,
  uploadRuntimeAsset,
  uploadSplatAsset,
  type SceneAsset as PersistedSceneAsset,
  type SaveSceneInput,
} from '@/lib/scenes/api';
import {
  runtimeAssetDirectory,
  referencedRuntimePaths,
  runtimeAssetIdForPath,
  rewriteRuntimePaths,
  runtimeSplatPath,
  sanitizedRuntimeFilename,
} from '@/lib/scenes/assetReferences';
import { assertObjectSceneBudget } from '@/lib/editor/objectBudget';
import { getAsset, objectModelConversion, queryAssets } from '@/lib/scenes/assetsApi';
import { sha256Hex } from '@/lib/scenes/sha256';
import { downloadSceneArchive, downloadSceneXml, xmlFilename } from '@/lib/scenes/sceneArchive';
import {
  exportScenePackage,
  importScenePackage,
  externalFileReferences,
  ScenePackageEntrypointError,
  scenePackageFilename,
} from '@/lib/scenes/scenePackage';
import { noticeFromError } from '@/lib/notices';
import { recordSceneRevision, type SceneRevision } from '@/lib/scenes/revisions';
import type { RobotSummary } from '@/lib/scenes/api';
import { obj2mjcfFileUrl, type Obj2MjcfConversion } from '@/lib/scenes/obj2mjcfApi';
import { URL_CHARS } from '@/lib/http/urlChars';
import {
  matrixFromRuntime,
  mountedCameraPoseFor,
  mujocoPointFromThree,
  type ViewportCameraPose,
} from '@/lib/editor/runtimeTransforms';
import {
  extractTextureUrlsFromMjcf,
  RuntimeTextureUrlRegistry,
  graphWithEditorMetadata,
  graphWithTextureFaces,
  backdropFromGraph,
  parseBackdrop,
  type PersistedBackdropV2,
  homePoseFromGraph,
  textureFacesFromGraph,
} from '@/lib/editor/texturePersistence';
import { isBoxSourceTarget, visualGeomIds } from '@/lib/editor/sceneGraph';
import { formatMjcf } from '@/lib/editor/mjcfSource';
import { canScaleNode } from '@/lib/editor/viewportGeometry';
import { useEditorStore, type SplatAssetRef, type SplatFileState } from '@/lib/store/editorStore';

const AUTOSAVE_INTERVAL_MS = 30_000;
/** Runtime path of a splat that has not been uploaded yet. */
const LOCAL_SPLAT_PATH = 'splats/local/backdrop.ply';
/** `LOCAL_SPLAT_PATH` with the extension of the splat's actual format (PLY or SPZ). */
const localSplatPath = (bytes: Uint8Array) =>
  `splats/local/${splatFilename('backdrop', splatFormatOf(bytes))}`;

/** Calibration persisted with a splat being restored, applied when its points arrive. */
interface SplatRestore {
  calibration: SplatCalibration;
  origin: Vec3Tuple;
}

type UploadedSplat = SplatAssetRef;

export interface EditorShellProps {
  projectId?: number;
  sceneId?: number;
  sceneCreatedAt?: string;
  initialScene?: string;
  initialSceneName?: string;
  initialTemplateId?: string;
  initialFiles?: readonly RuntimeFile[];
  initialSplatFile?: RuntimeFile;
  initialAssets?: readonly (number | PersistedSceneAsset)[];
  initialGraph?: unknown;
}

interface PreparedScene {
  input: SaveSceneInput;
  xml: string;
  files: Map<string, RuntimeFile>;
  uploadedAssets: PersistedSceneAsset[];
  /** The backdrop asset this save references, or null when the scene has none. */
  splat: UploadedSplat | null;
  backdrop: PersistedBackdropV2 | null;
}

/** World position and row-major rotation of the loaded backdrop body, or null. */
function backdropWorldPose(
  simulation: Simulation | null,
): { position: Float64Array; rotation: Float64Array } | null {
  if (!simulation) return null;
  let id = -1;
  try {
    id = simulation.bodyIndex(SPLAT_BACKDROP_BODY);
  } catch {
    return null;
  }
  if (id < 0) return null;
  return {
    position: simulation.bodyPositions.subarray(id * 3, id * 3 + 3),
    rotation: simulation.bodyRotations.subarray(id * 9, id * 9 + 9),
  };
}

/** World rotation `[w, x, y, z]` of the loaded backdrop body (a worldbody child), or null. */
function backdropWorldQuat(simulation: Simulation | null): QuaternionTuple | null {
  if (!simulation) return null;
  let id: number;
  try {
    id = simulation.bodyIndex(SPLAT_BACKDROP_BODY);
  } catch {
    return null;
  }
  const r = simulation.bodyRotations.subarray(id * 9, id * 9 + 9);
  const q = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().set(
      r[0],
      r[1],
      r[2],
      0,
      r[3],
      r[4],
      r[5],
      0,
      r[6],
      r[7],
      r[8],
      0,
      0,
      0,
      0,
      1,
    ),
  );
  return [q.w, q.x, q.y, q.z];
}

/** `euler` of a yaw-only body quaternion, in the scene's compiler angle unit. */
function yawEuler(bodyQuat: QuaternionTuple, xml: string): [number, number, number] {
  const yaw = 2 * Math.atan2(bodyQuat[3], bodyQuat[0]);
  return [0, 0, compilerAngleUnit(xml) === 'radian' ? yaw : THREE.MathUtils.radToDeg(yaw)];
}

function artifactFor(
  value: SceneAsset['canonicalMesh'] | SceneAsset['collisionMesh'],
): SceneAssetArtifact | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as {
    id?: unknown;
    filename?: unknown;
    url?: unknown;
    mimeType?: unknown;
  };
  const id = typeof candidate.id === 'number' ? candidate.id : Number(candidate.id);
  if (!Number.isInteger(id) || id < 1 || typeof candidate.filename !== 'string') return null;
  return {
    id,
    filename: candidate.filename,
    url: typeof candidate.url === 'string' ? candidate.url : null,
    mimeType: typeof candidate.mimeType === 'string' ? candidate.mimeType : null,
  };
}

function dimensionsForAsset(asset: SceneAsset): readonly [number, number, number] {
  const values = asset.metadata?.dimensionsMeters?.map((entry) => entry.value);
  if (values?.length === 3 && values.every((value) => Number.isFinite(value) && value > 0)) {
    return [values[0], values[1], values[2]];
  }
  if (asset.primitive) {
    return [
      Math.max(asset.primitive.size[0], 0.1),
      Math.max(asset.primitive.size[1] || asset.primitive.size[0], 0.1),
      Math.max(asset.primitive.size[2] || asset.primitive.size[0], 0.1),
    ];
  }
  return [0.2, 0.2, 0.2];
}

function samePose(
  left: Readonly<Record<string, number>> | null,
  right: Readonly<Record<string, number>> | null,
): boolean {
  const leftKeys = left ? Object.keys(left).sort() : [];
  const rightKeys = right ? Object.keys(right).sort() : [];
  if (
    leftKeys.length !== rightKeys.length ||
    leftKeys.some((key, index) => key !== rightKeys[index])
  ) {
    return false;
  }
  return leftKeys.every((key) => left?.[key] === right?.[key]);
}

function validateHomePose(
  pose: Readonly<Record<string, number>> | null,
  joints: readonly { name: string; range: readonly [number, number]; limited: boolean }[],
): string | null {
  if (!pose || Object.keys(pose).length === 0) return null;
  const jointsByName = new Map(joints.map((joint) => [joint.name, joint]));
  for (const [name, value] of Object.entries(pose)) {
    const joint = jointsByName.get(name);
    if (!joint)
      return `Home pose joint '${name}' is no longer present. Clear the reset pose in Evaluation.`;
    if (!Number.isFinite(value))
      return `Home pose joint '${name}' is invalid. Clear the reset pose in Evaluation.`;
    if (joint.limited && (value < joint.range[0] || value > joint.range[1])) {
      return `Home pose joint '${name}' is outside the current range. Clear the reset pose in Evaluation.`;
    }
  }
  return null;
}

function robotMeshSourceFiles(mjcf: string): string[] {
  const document = new DOMParser().parseFromString(mjcf, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('This robot has invalid MJCF.');
  const files = [...document.querySelectorAll(':scope > asset > mesh')].map((mesh) => {
    const file = mesh
      .getAttribute('file')
      ?.replaceAll('\\', '/')
      .replace(/^assets\//, '');
    if (!file || file.includes('/') || file.includes('..')) {
      throw new Error('This robot contains an unsafe mesh path.');
    }
    return file;
  });
  if (!files.length || new Set(files).size !== files.length) {
    throw new Error('This robot does not have a valid mesh manifest.');
  }
  return files;
}

export function EditorShell({
  projectId,
  sceneId,
  sceneCreatedAt: initialSceneCreatedAt,
  initialScene,
  initialSceneName,
  initialTemplateId,
  initialFiles,
  initialSplatFile,
  initialAssets,
  initialGraph,
}: EditorShellProps) {
  const {
    status,
    error,
    graph,
    getSimulation,
    loadScene,
    getLastLoadError,
    loadedSceneKey,
    stageFiles,
    retainFiles,
    pause,
    setResetPose,
    clearResetPose,
    getResetPoseJointPositions,
  } = usePhysics();
  const { streaming: evaluationStreaming } = useEvaluationRuntime();
  const {
    session: teleoperationSession,
    snapshot: teleoperationSnapshot,
    stopStream: stopTeleoperationStream,
    restoreSelectedState: restoreTeleoperationState,
    streaming: teleoperationStreaming,
  } = useTeleoperationRuntime();
  const [buildSwitchWarning, setBuildSwitchWarning] = useState(false);
  const router = useRouter();
  const xml = useEditorStore((state) => state.xml);
  const savedXml = useEditorStore((state) => state.savedXml);
  const replaceXml = useEditorStore((state) => state.replaceXml);
  const markSaved = useEditorStore((state) => state.markSaved);
  const markUnsaved = useEditorStore((state) => state.markUnsaved);
  const commitXml = useEditorStore((state) => state.commitXml);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const clearSelection = useEditorStore((state) => state.clearSelection);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const editingId = useEditorStore((state) => state.editingId);
  const editTool = useEditorStore((state) => state.editTool);
  const transformMode = useEditorStore((state) => state.transformMode);
  const editingNode = graph && editingId ? (graph.nodes[editingId] ?? null) : null;
  const beginEdit = useEditorStore((state) => state.beginEdit);
  const endEdit = useEditorStore((state) => state.endEdit);
  const toggleTransformAxis = useEditorStore((state) => state.toggleTransformAxis);
  const setTransformMode = useEditorStore((state) => state.setTransformMode);
  const setEditTool = useEditorStore((state) => state.setEditTool);
  const toggleSnap = useEditorStore((state) => state.toggleSnap);
  const select = useEditorStore((state) => state.select);
  const splatSrc = useEditorStore((state) => state.splatSrc);
  const splatOrigin = useEditorStore((state) => state.splatOrigin);
  const setSplatSrc = useEditorStore((state) => state.setSplatSrc);
  const setSplatStatus = useEditorStore((state) => state.setSplatStatus);
  const setSplatBackdrop = useEditorStore((state) => state.setSplatBackdrop);
  const backdropBodyNode = graph
    ? Object.values(graph.nodes).find(
        (node) => node.kind === 'body' && node.name === SPLAT_BACKDROP_BODY,
      )
    : null;
  const clearSplat = useEditorStore((state) => state.clearSplat);
  const splatSceneKey = useEditorStore((state) => state.splatSceneKey);
  const setSplatSceneKey = useEditorStore((state) => state.setSplatSceneKey);
  const splatCalibration = useEditorStore((state) => state.splatCalibration);
  const splatFile = useEditorStore((state) => state.splatFile);
  const replaceSplatFile = useEditorStore((state) => state.setSplatFile);
  const setSplatAsset = useEditorStore((state) => state.setSplatAsset);
  const [source, setSource] = useState(xml);
  const [sceneName, setSceneName] = useState(initialSceneName ?? DEFAULT_SCENE.name);
  const [activeSceneId, setActiveSceneId] = useState<number | null>(sceneId ?? null);
  const [sceneCreatedAt, setSceneCreatedAt] = useState(initialSceneCreatedAt);
  const [saving, setSaving] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceModeState] = useState<WorkspaceMode>('build');
  const [rightPanel, setRightPanel] = useState<'inspector' | 'mjcf' | 'revisions'>('inspector');
  const [leftPanel, setLeftPanel] = useState<'scene' | 'assets' | 'robots' | 'splat'>('scene');
  const [previewCameraId, setPreviewCameraId] = useState<string | null>(null);
  // Off-screen renders for MCP render_camera; one at a time, like every MCP command.
  const [cameraCapture, setCameraCapture] = useState<CameraCaptureRequest | null>(null);
  const cameraCaptureWaiters = useRef(new Map<string, (result: CameraCaptureResult) => void>());
  const [previewAsset, setPreviewAsset] = useState<PreviewableAsset | null>(null);
  const [episodeCameraHost, setEpisodeCameraHost] = useState<HTMLDivElement | null>(null);
  const [episodeStatsHost, setEpisodeStatsHost] = useState<HTMLDivElement | null>(null);
  const [draggedAsset, setDraggedAsset] = useState<SceneAsset | null>(null);
  const [textureUrlsByMaterial, setTextureUrlsByMaterial] = useState<Record<string, string>>({});
  const [textureUrlsByGeom, setTextureUrlsByGeom] = useState<Record<string, string>>({});
  const [textureFaceByGeom, setTextureFaceByGeom] = useState<Record<string, BoxFace>>({});
  const [textureFaceStateReady, setTextureFaceStateReady] = useState(false);
  const [generationRuntimeFiles, setGenerationRuntimeFiles] = useState<RuntimeFile[]>(() => [
    ...(initialFiles ?? []),
  ]);
  const [generationSourceBody, setGenerationSourceBody] = useState<string>();
  const [generationPickStage, setGenerationPickStage] = useState<GenerationPickStage | null>(null);
  const [generationPickMessage, setGenerationPickMessage] = useState<string | null>(null);
  const [homePose, setHomePose] = useState<Record<string, number> | null>(null);
  const [savedHomePose, setSavedHomePose] = useState<Record<string, number> | null>(null);
  const [homePoseStatus, setHomePoseStatus] = useState<string | null>(null);
  const [revisionRefreshKey, setRevisionRefreshKey] = useState(0);
  // A node just inserted: selected once the recompiled graph has it (and edited with `edit`).
  const pendingPlacedNode = useRef<{ kind: SceneNodeKind; name: string; edit?: boolean } | null>(
    null,
  );
  // Unsaved "new scene" sessions need a unique runtime key, so they don't collide
  // with an abandoned new scene from the same project and skip reloading its hierarchy.
  const newSessionId = useId();
  const initializedDocument = useRef<string | null>(null);
  const hydratedTextureDocument = useRef<string | null>(null);
  const hydratedHomePoseDocument = useRef<string | null>(null);
  const restoredSplatKey = useRef<string | null>(null);
  const splatPointsRef = useRef<SplatPoint[]>([]);
  const restoringSplatRef = useRef<SplatRestore | null>(null);
  // Set by a new upload: its orientation is detected once its points arrive.
  const detectSplatOrientationRef = useRef(false);
  const [splatOrientationNote, setSplatOrientationNote] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  // Outcome of the last Add table or Match height (instructions, and which objects moved).
  const [tableNote, setTableNote] = useState<string | null>(null);
  // A splat uploaded by a save that then failed, reused when the save is retried. The asset saved
  // with the scene lives in the editor store (`splatAsset`).
  const uploadedSplatRef = useRef<UploadedSplat | null>(null);
  // Set when saving a new scene re-keys its splat; skips the one clear check that would otherwise
  // see the new key before the scene id catches up and discard the splat just uploaded.
  const suppressSplatClearRef = useRef(false);
  const stagedRuntimeFiles = useRef(new Map<string, RuntimeFile>());
  const runtimeTextureUrls = useRef(new RuntimeTextureUrlRegistry());
  const localRuntimePaths = useRef(new Set<string>());
  const uploadedRuntimeAssets = useRef(
    new Map<string, { asset: PersistedSceneAsset; path: string }>(),
  );
  const archiveInput = useRef<HTMLInputElement>(null);
  const xmlInput = useRef<HTMLInputElement>(null);
  const showNotice = useNotice();
  const [pendingPackageImport, setPendingPackageImport] = useState<{
    file: File;
    candidates: string[];
  } | null>(null);
  const cameraPoseRef = useRef<ViewportCameraPose | null>(null);
  const viewportRef = useRef<ViewportHandle | null>(null);
  // The MJCF panel shows the document pretty-printed; a draft only counts as dirty once it differs
  // from both the stored document and its formatted view.
  const formattedXml = useMemo(() => formatMjcf(xml), [xml]);
  const sourceDirty = source !== xml && source !== formattedXml;
  const currentHomePoseError = validateHomePose(
    homePose,
    getSimulation()?.getScalarJointStates() ?? [],
  );
  const documentDirty = sourceDirty || xml !== savedXml || !samePose(homePose, savedHomePose);
  const runtimeSceneKey =
    sceneId !== undefined ? `scene:${sceneId}` : `new:${projectId ?? 'local'}:${newSessionId}`;
  const enterBuild = useCallback(() => {
    setWorkspaceModeState('build');
    setGenerationPickStage(null);
    setGenerationPickMessage(null);
  }, []);
  const teleoperationRecording =
    teleoperationSession?.recording === 'recording' ||
    teleoperationSnapshot?.header.recording === 'recording';
  const changeWorkspaceMode = useCallback(
    (mode: WorkspaceMode, options: { confirmed?: boolean } = {}) => {
      if (mode !== 'build' && editingId) return;
      // Leaving Generate for Build while it streams or records: say what edits will do first.
      if (
        mode === 'build' &&
        workspaceMode === 'generate' &&
        !options.confirmed &&
        (teleoperationStreaming || teleoperationRecording)
      ) {
        setBuildSwitchWarning(true);
        return;
      }
      if (mode !== 'generate') {
        setGenerationPickStage(null);
        setGenerationPickMessage(null);
      }
      if (mode !== 'build') pause();
      setWorkspaceModeState(mode);
    },
    [editingId, pause, teleoperationRecording, teleoperationStreaming, workspaceMode],
  );
  const randomizationOpen = useEditorStore(
    (state) => state.expanded['generate:randomization'] ?? false,
  );
  // The zone editor shows while Generate's Randomization section is open, for the same object the
  // panel randomizes (its pick, or the default the panel falls back to).
  const generationZone = useMemo((): GenerationZoneTarget | null => {
    if (workspaceMode !== 'generate' || !randomizationOpen || status !== 'ready') return null;
    const movable = sourceBodiesFromXml(xml).filter((source) => source.movable);
    const body =
      movable.find((source) => source.body === generationSourceBody)?.body ??
      preferredSourceBody(movable);
    const source = movable.find((candidate) => candidate.body === body);
    if (!source) return null;
    return {
      sceneKey: String(activeSceneId ?? 'new'),
      body: source.body,
      origin: source.position,
      disabled: teleoperationRecording,
      bodyOrigins: Object.fromEntries(movable.map((entry) => [entry.body, entry.position])),
    };
  }, [
    activeSceneId,
    generationSourceBody,
    randomizationOpen,
    status,
    teleoperationRecording,
    workspaceMode,
    xml,
  ]);
  const beginGenerationSelection = useCallback(
    (stage: GenerationPickStage) => {
      if (editingId || documentDirty || status !== 'ready') return;
      setGenerationPickMessage(null);
      setGenerationPickStage(stage);
    },
    [documentDirty, editingId, status],
  );
  const cancelGenerationSelection = useCallback(() => {
    setGenerationPickStage(null);
    setGenerationPickMessage(null);
  }, []);
  const selectGenerationBody = useCallback(
    (bodyName: string) => {
      if (!generationPickStage || !graph) return;
      // Eligible: top-level bodies with geometry and a free joint (the objects Generate can move).
      const candidateNames = new Set(
        graph.order
          .map((id) => graph.nodes[id])
          .filter(
            (candidate) =>
              candidate?.kind === 'body' &&
              candidate.parentId === graph.rootId &&
              candidate.childIds.some((id) => graph.nodes[id]?.kind === 'geom') &&
              candidate.childIds.some(
                (id) => graph.nodes[id]?.kind === 'joint' && graph.nodes[id].jointType === 0,
              ),
          )
          .map((candidate) => candidate.name),
      );
      if (!candidateNames.has(bodyName)) {
        setGenerationPickMessage('Choose an eligible source object.');
        return;
      }
      const node = graph.order
        .map((id) => graph.nodes[id])
        .find((candidate) => candidate.kind === 'body' && candidate.name === bodyName);
      if (!node || node.kind !== 'body' || node.parentId !== graph.rootId) {
        setGenerationPickMessage('Choose a top-level rigid body in the scene.');
        return;
      }
      setGenerationSourceBody(bodyName);
      setGenerationPickStage(null);
      setGenerationPickMessage(null);
      select(node.id);
    },
    [generationPickStage, graph, select],
  );
  useEffect(() => {
    queueMicrotask(() => {
      setGenerationSourceBody(undefined);
      setGenerationPickStage(null);
      setGenerationPickMessage(null);
      setHomePose(null);
      setSavedHomePose(null);
      setHomePoseStatus(null);
    });
  }, [runtimeSceneKey]);
  /** Drops the loaded splat (and its blob URL) without touching the MJCF. */
  const discardSplat = useCallback(() => {
    const current = useEditorStore.getState().splatSrc;
    if (current) URL.revokeObjectURL(current);
    restoringSplatRef.current = null;
    detectSplatOrientationRef.current = false;
    splatPointsRef.current = [];
    setSplatOrientationNote(null);
    setTableNote(null);
    clearSplat();
  }, [clearSplat]);
  useEffect(() => {
    // The splat belongs to one scene; drop it when switching away, not on every remount.
    if (suppressSplatClearRef.current) {
      suppressSplatClearRef.current = false;
      return;
    }
    if (splatSceneKey !== null && splatSceneKey !== runtimeSceneKey) queueMicrotask(discardSplat);
  }, [discardSplat, runtimeSceneKey, splatSceneKey]);
  useEffect(() => {
    // Restore the scene's splat: the saved backdrop PLY (downloaded with the scene) or, for a
    // splat added since the last save, the IndexedDB copy. The persisted calibration and origin
    // are applied atomically with the source so they are not reset; handleSplatLoad then
    // re-derives the heightfield from the reloaded points and keeps the MJCF body pose.
    if (splatSrc) {
      const store = useEditorStore.getState();
      if (store.splatSceneKey === runtimeSceneKey) {
        // A remount (first save of a new scene) reloads this scene's splat: keep its body pose.
        if (
          restoredSplatKey.current !== runtimeSceneKey &&
          !restoringSplatRef.current &&
          !detectSplatOrientationRef.current
        ) {
          restoringSplatRef.current = {
            calibration: store.splatCalibration,
            origin: store.splatOrigin ?? [0, 0, 0],
          };
        }
        restoredSplatKey.current = runtimeSceneKey;
      }
      return;
    }
    if (status !== 'ready' || !graph) return;
    if (restoredSplatKey.current === runtimeSceneKey) return;
    const restoreKey = runtimeSceneKey;
    restoredSplatKey.current = restoreKey;
    const backdrop = backdropFromGraph(initialGraph);
    // Remember the saved backdrop even when its file failed to download, so saving the scene
    // keeps the record instead of dropping the user's splat.
    setSplatAsset(
      backdrop
        ? {
            assetId: backdrop.assetId,
            hash: backdrop.hash,
            path: initialSplatFile?.path ?? LOCAL_SPLAT_PATH,
            calibration: backdrop.calibration,
            origin: backdrop.origin,
            unreadable: !initialSplatFile,
          }
        : null,
    );
    uploadedSplatRef.current = null;
    void (async () => {
      let restored: (SplatFileState & SplatRestore) | null = null;
      if (initialSplatFile && backdrop) {
        if (activeSceneId) deleteCachedSplat(activeSceneId).catch(() => {});
        restored = {
          file: new Blob([initialSplatFile.bytes as Uint8Array<ArrayBuffer>]),
          filename: initialSplatFile.path.split('/').at(-1) ?? 'backdrop.ply',
          runtime: initialSplatFile,
          calibration: backdrop.calibration,
          origin: backdrop.origin,
        };
      } else if (activeSceneId) {
        const cached = sceneCreatedAt
          ? await loadCachedSplat(activeSceneId, sceneCreatedAt).catch(() => null)
          : null;
        if (cached && cached.hash !== backdrop?.hash) {
          const bytes = new Uint8Array(await cached.file.arrayBuffer());
          restored = {
            file: cached.file,
            filename: splatFilename('backdrop', splatFormatOf(bytes)),
            runtime: { path: localSplatPath(bytes), bytes, checksum: cached.hash, kind: 'splat' },
            calibration: cached.calibration,
            origin: cached.origin,
          };
        } else if (cached) {
          deleteCachedSplat(activeSceneId).catch(() => {});
        }
      }
      // Superseded by a scene switch, or the user picked a splat meanwhile.
      if (
        !restored ||
        restoredSplatKey.current !== restoreKey ||
        useEditorStore.getState().splatSrc
      ) {
        return;
      }
      restoringSplatRef.current = { calibration: restored.calibration, origin: restored.origin };
      replaceSplatFile({
        file: restored.file,
        filename: restored.filename,
        runtime: restored.runtime,
      });
      setSplatSrc(URL.createObjectURL(restored.file), {
        calibration: restored.calibration,
        sceneKey: restoreKey,
      });
    })();
  }, [
    activeSceneId,
    sceneCreatedAt,
    graph,
    initialGraph,
    initialSplatFile,
    replaceSplatFile,
    runtimeSceneKey,
    setSplatAsset,
    setSplatSrc,
    splatSrc,
    status,
  ]);
  const resetTextureState = useCallback(
    (
      documentXml: string,
      runtimeFiles: readonly RuntimeFile[],
      assets: readonly (number | PersistedSceneAsset)[],
    ) => {
      runtimeTextureUrls.current.sync(runtimeFiles);
      setTextureUrlsByMaterial(
        extractTextureUrlsFromMjcf(documentXml, runtimeFiles, assets, (path) =>
          runtimeTextureUrls.current.get(path),
        ),
      );
      setTextureUrlsByGeom({});
      setTextureFaceByGeom({});
      setTextureFaceStateReady(false);
    },
    [],
  );
  useEffect(() => () => runtimeTextureUrls.current.dispose(), []);
  const hydrateTextureFaces = useEffectEvent((faces: Record<string, BoxFace>) => {
    setTextureFaceByGeom(faces);
    setTextureFaceStateReady(true);
  });
  const resetHomePoseState = useCallback(() => {
    clearResetPose();
    setHomePose(null);
    setSavedHomePose(null);
    setHomePoseStatus(null);
  }, [clearResetPose]);
  const clearHomePose = useCallback(() => {
    clearResetPose();
    setHomePose(null);
    setHomePoseStatus(null);
  }, [clearResetPose]);
  const syncInitialDocument = useEffectEvent(
    (isCurrentRuntime: boolean, runtimeFiles: readonly RuntimeFile[]) => {
      setGenerationRuntimeFiles([...runtimeFiles]);
      setActiveSceneId(sceneId ?? null);
      setSceneName(initialSceneName ?? DEFAULT_SCENE.name);
      if (isCurrentRuntime) {
        resetTextureState(xml, runtimeFiles, initialAssets ?? []);
        setSource(xml);
      } else {
        const documentXml = initialScene ?? DEFAULT_SCENE.xml;
        resetTextureState(documentXml, runtimeFiles, initialAssets ?? []);
        replaceXml(documentXml, { markSaved: !initialTemplateId });
        if (initialTemplateId) markUnsaved();
        if (initialTemplateId) {
          localRuntimePaths.current = new Set(runtimeFiles.map((runtimeFile) => runtimeFile.path));
        }
        setSource(documentXml);
      }
    },
  );

  useEffect(() => {
    if (!initialScene || status !== 'ready') return;
    const documentKey = `${runtimeSceneKey}:${initialScene}`;
    if (initializedDocument.current === documentKey) return;

    const isCurrentRuntime = loadedSceneKey === runtimeSceneKey;
    if (!isCurrentRuntime) {
      // The splat PLY is never staged into MuJoCo's filesystem (it is not an MJCF asset).
      stageFiles(initialFiles ?? []);
      if (!loadScene(initialScene, initialSceneName ?? DEFAULT_SCENE.name, runtimeSceneKey)) {
        return;
      }
    }

    initializedDocument.current = documentKey;
    hydratedTextureDocument.current = null;
    const runtimeFiles = [...(initialFiles ?? [])];
    stagedRuntimeFiles.current = new Map(
      runtimeFiles.map((runtimeFile) => [runtimeFile.path, runtimeFile]),
    );
    if (!isCurrentRuntime) {
      localRuntimePaths.current.clear();
      uploadedRuntimeAssets.current.clear();
    }
    queueMicrotask(() => syncInitialDocument(isCurrentRuntime, runtimeFiles));
  }, [
    initialAssets,
    initialFiles,
    initialScene,
    initialSceneName,
    initialTemplateId,
    loadScene,
    markUnsaved,
    loadedSceneKey,
    replaceXml,
    resetTextureState,
    sceneId,
    stageFiles,
    status,
    runtimeSceneKey,
  ]);

  useEffect(() => {
    if (!initialScene || !graph) return;
    const documentKey = `${runtimeSceneKey}:${initialScene}`;
    if (hydratedHomePoseDocument.current === documentKey) return;
    const persistedHomePose = homePoseFromGraph(initialGraph);
    const positions =
      persistedHomePose?.jointPositions ??
      (loadedSceneKey === runtimeSceneKey ? getResetPoseJointPositions() : null);
    const error = validateHomePose(positions, getSimulation()?.getScalarJointStates() ?? []);
    hydratedHomePoseDocument.current = documentKey;
    queueMicrotask(() => {
      if (positions && !error) {
        setResetPose(positions);
        setHomePose({ ...positions });
        setSavedHomePose({ ...positions });
        setHomePoseStatus(null);
      } else {
        clearResetPose();
        setHomePose(positions ? { ...positions } : null);
        setSavedHomePose(positions ? { ...positions } : null);
        setHomePoseStatus(error);
      }
    });
  }, [
    clearResetPose,
    getResetPoseJointPositions,
    getSimulation,
    graph,
    initialGraph,
    initialScene,
    loadedSceneKey,
    runtimeSceneKey,
    setResetPose,
  ]);

  useEffect(() => {
    if (!initialScene || !graph) return;
    const documentKey = `${runtimeSceneKey}:${initialScene}`;
    if (
      initializedDocument.current !== documentKey ||
      hydratedTextureDocument.current === documentKey
    ) {
      return;
    }
    const persistedEditor =
      initialGraph && typeof initialGraph === 'object'
        ? (initialGraph as { editor?: unknown }).editor
        : null;
    const persistedTextureFaces =
      persistedEditor && typeof persistedEditor === 'object'
        ? (persistedEditor as { textureFaces?: unknown }).textureFaces
        : null;
    const hasPersistedTextureFaces =
      persistedTextureFaces &&
      typeof persistedTextureFaces === 'object' &&
      Object.keys(persistedTextureFaces).length > 0;
    const hydratedFaces = textureFacesFromGraph(initialGraph, graph);
    if (hasPersistedTextureFaces && !Object.keys(hydratedFaces).length) return;
    hydratedTextureDocument.current = documentKey;
    queueMicrotask(() => hydrateTextureFaces(hydratedFaces));
  }, [graph, initialGraph, initialScene, runtimeSceneKey]);

  useEffect(() => {
    if (!documentDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [documentDirty]);

  const stageEditorFiles = useCallback(
    (files: readonly RuntimeFile[]) => {
      stageFiles(files);
      for (const file of files) stagedRuntimeFiles.current.set(file.path, file);
      setGenerationRuntimeFiles([...stagedRuntimeFiles.current.values()]);
    },
    [stageFiles],
  );

  useEffect(() => {
    let cachedReferences = new Map<string, string[]>();
    return useEditorStore.subscribe((state, previous) => {
      if (
        state.xml === previous.xml &&
        state.savedXml === previous.savedXml &&
        state.history === previous.history
      )
        return;
      const documents = [
        state.xml,
        state.savedXml,
        ...state.history.past.map((entry) => entry.xml),
        ...state.history.future.map((entry) => entry.xml),
      ];
      // This runs inside every editor store update, so it must never throw: if any document's
      // references cannot be read, keep every staged file rather than risk unlinking a live one.
      let nextReferences: Map<string, string[]>;
      try {
        nextReferences = new Map(
          documents.map((document) => [
            document,
            cachedReferences.get(document) ?? referencedRuntimePaths(document),
          ]),
        );
      } catch (error) {
        console.warn('Skipped runtime file cleanup; a scene document could not be read.', error);
        return;
      }
      cachedReferences = nextReferences;
      const retained = new Set([...nextReferences.values()].flat());
      const files = stagedRuntimeFiles.current;
      let changed = false;
      for (const [path, file] of files) {
        if (file.kind === 'splat' || retained.has(path)) continue;
        files.delete(path);
        changed = true;
      }
      // Reconcile the MuJoCo FS on every document change, not only when this map shrinks: a scene
      // switch replaces the map before the store update, and a rejected insert stages files that
      // never enter it. Every staging site stages synchronously right before it compiles, so all
      // live files are in the map or referenced by a document here.
      try {
        retainFiles(new Set([...files.keys(), ...retained]));
      } catch (error) {
        console.warn('Could not release unused runtime files.', error);
      }
      if (changed) {
        const remaining = [...files.values()];
        runtimeTextureUrls.current.sync(remaining);
        setGenerationRuntimeFiles(remaining);
      }
    });
  }, [retainFiles]);

  // Single choke point for every MJCF mutation: nothing may push to history
  // (`commitXml`) or replace the working document (`replaceXml`) unless MuJoCo
  // has already accepted the candidate XML via `loadScene`. Call sites must not
  // call `loadScene`, `commitXml`, or `replaceXml` directly for document edits.
  const applyCompiledXml = useCallback(
    (nextXml: string, name: string, mode: 'incremental' | 'replace' | 'history'): boolean => {
      if (!loadScene(nextXml, name)) return false;
      if (mode === 'incremental') commitXml(nextXml);
      else if (mode === 'replace') replaceXml(nextXml);
      setSource(nextXml);
      return true;
    },
    [commitXml, loadScene, replaceXml],
  );

  const applyDocument = useCallback(
    (nextXml: string) => {
      applyCompiledXml(nextXml, sceneName, 'incremental');
    },
    [applyCompiledXml, sceneName],
  );

  const prepareScenePersistence = useCallback(
    async (name: string): Promise<PreparedScene> => {
      if (!projectId) throw new Error('Select a project before saving.');
      let nextXml = xml;
      let nextGraph: typeof graph = graph;
      const currentSimulation = getSimulation();
      if (currentSimulation) nextGraph = buildSceneGraph(currentSimulation);
      const nextFiles = new Map(stagedRuntimeFiles.current);
      const pathMap = new Map<string, string>();
      const uploadedRuntimeFiles: RuntimeFile[] = [];
      let restoredDocument = false;

      try {
        for (const localPath of localRuntimePaths.current) {
          const runtimeFile = stagedRuntimeFiles.current.get(localPath);
          if (!runtimeFile) throw new Error(`Local scene asset "${localPath}" is unavailable.`);

          let uploaded = uploadedRuntimeAssets.current.get(localPath);
          if (!uploaded) {
            const asset = await uploadRuntimeAsset(projectId, runtimeFile);
            const directory = runtimeAssetDirectory(runtimeFile.path);
            uploaded = {
              asset,
              path: `${directory}/${asset.id}/${sanitizedRuntimeFilename(asset.filename ?? localPath)}`,
            };
            uploadedRuntimeAssets.current.set(localPath, uploaded);
          }

          pathMap.set(localPath, uploaded.path);
          nextFiles.delete(localPath);
          const uploadedRuntimeFile = {
            ...runtimeFile,
            path: uploaded.path,
            checksum: runtimeFile.checksum,
          };
          nextFiles.set(uploaded.path, uploadedRuntimeFile);
          uploadedRuntimeFiles.push(uploadedRuntimeFile);
        }

        if (pathMap.size) {
          // Stage only after every upload has finished: an edit during an await above would
          // release files that no document references yet.
          stageFiles(uploadedRuntimeFiles);
          nextXml = rewriteRuntimePaths(xml, pathMap);
          const nextSimulation = loadScene(nextXml, sceneName);
          if (!nextSimulation) throw new Error('MuJoCo rejected the asset paths for this scene.');
          nextGraph = buildSceneGraph(nextSimulation);
          restoredDocument = true;
        }

        const assetIds = new Set<number>();
        for (const path of nextFiles.keys()) {
          const assetId = runtimeAssetIdForPath(path);
          if (assetId !== null) assetIds.add(assetId);
        }
        // The splat backdrop: reuse the saved asset when the PLY is unchanged (same hash), else
        // upload it once. A splat that could not be loaded this session keeps the saved record
        // as long as the MJCF still has the backdrop body.
        const backdropState = useEditorStore.getState();
        const currentSplat = backdropState.splatFile;
        const savedAsset = backdropState.splatAsset;
        let splat: UploadedSplat | null = null;
        let backdrop: PersistedBackdropV2 | null = null;
        if (
          currentSplat &&
          backdropState.splatSrc &&
          backdropState.splatOrigin &&
          hasSplatBackdrop(nextXml)
        ) {
          const hash = currentSplat.runtime.checksum;
          const reusable = [savedAsset, uploadedSplatRef.current].find(
            (candidate) => !!candidate && candidate.hash === hash && !candidate.unreadable,
          );
          if (reusable) {
            splat = reusable;
          } else {
            const asset = await uploadSplatAsset(
              projectId,
              currentSplat.file,
              currentSplat.filename,
            );
            splat = {
              assetId: asset.id,
              hash,
              path: runtimeSplatPath(asset),
              calibration: backdropState.splatCalibration,
              origin: backdropState.splatOrigin ?? [0, 0, 0],
            };
            uploadedSplatRef.current = splat;
          }
          const selectedSplat = splat;
          backdrop = {
            version: 2,
            assetId: selectedSplat.assetId,
            hash,
            calibration: backdropState.splatCalibration,
            origin: backdropState.splatOrigin ?? [0, 0, 0],
          };
        } else if (savedAsset && hasSplatBackdrop(nextXml)) {
          splat = savedAsset;
          backdrop = {
            version: 2,
            assetId: savedAsset.assetId,
            hash: savedAsset.hash,
            calibration: savedAsset.calibration,
            origin: savedAsset.origin,
          };
        }
        if (splat) assetIds.add(splat.assetId);
        const effectiveTextureFaces = textureFaceStateReady
          ? textureFaceByGeom
          : textureFacesFromGraph(initialGraph, nextGraph);
        const persistedGraph = nextGraph
          ? graphWithEditorMetadata(graphWithTextureFaces(nextGraph, effectiveTextureFaces), {
              homePose: homePose ? { version: 1, jointPositions: { ...homePose } } : null,
              backdrop,
            })
          : nextGraph;
        const input = {
          name,
          project: projectId,
          mjcf: nextXml,
          graph: persistedGraph,
          assets: [...assetIds],
        };
        return {
          input,
          xml: nextXml,
          files: nextFiles,
          uploadedAssets: [...uploadedRuntimeAssets.current.values()].map(({ asset }) => asset),
          splat,
          backdrop,
        };
      } catch (reason) {
        if (restoredDocument) loadScene(useEditorStore.getState().xml, sceneName);
        throw reason;
      }
    },
    [
      getSimulation,
      graph,
      homePose,
      initialGraph,
      loadScene,
      projectId,
      sceneName,
      stageFiles,
      textureFaceByGeom,
      textureFaceStateReady,
      xml,
    ],
  );

  const applyPersistedRuntimeState = useCallback(
    (prepared: PreparedScene) => {
      // Saving awaits uploads after staging; restage in case an edit meanwhile released files the
      // saved document now references (a checksum no-op when they are still staged).
      stageFiles([...prepared.files.values()]);
      if (prepared.xml !== xml) {
        commitXml(prepared.xml);
        setSource(prepared.xml);
      }
      stagedRuntimeFiles.current = prepared.files;
      setGenerationRuntimeFiles([...prepared.files.values()]);
      const runtimeFiles = [...prepared.files.values()];
      runtimeTextureUrls.current.sync(runtimeFiles);
      setTextureUrlsByMaterial(
        extractTextureUrlsFromMjcf(
          prepared.xml,
          runtimeFiles,
          [...(initialAssets ?? []), ...prepared.uploadedAssets],
          (path) => runtimeTextureUrls.current.get(path),
        ),
      );
      localRuntimePaths.current.clear();
      uploadedRuntimeAssets.current.clear();
      setSplatAsset(
        prepared.splat && prepared.backdrop
          ? {
              ...prepared.splat,
              calibration: prepared.backdrop.calibration,
              origin: prepared.backdrop.origin,
            }
          : null,
      );
      uploadedSplatRef.current = null;
      // Workers read the splat from its uploaded asset path from now on.
      const current = useEditorStore.getState().splatFile;
      if (prepared.splat && current && current.runtime.checksum === prepared.splat.hash) {
        replaceSplatFile({
          ...current,
          runtime: { ...current.runtime, path: prepared.splat.path },
        });
      }
    },
    [commitXml, initialAssets, replaceSplatFile, setSplatAsset, stageFiles, xml],
  );

  /**
   * Saves the scene. A user-initiated save (`notify`) reports problems in a dialog; autosave only
   * updates the Save button tooltip so a recurring failure does not keep interrupting the user.
   */
  const save = useCallback(
    async ({ notify = false }: { notify?: boolean } = {}) => {
      if (!projectId || status !== 'ready' || saving) return;
      const splatState = useEditorStore.getState();
      if (
        splatState.splatStatus === 'loading' &&
        (!splatState.splatAsset ||
          splatState.splatAsset.hash !== splatState.splatFile?.runtime.checksum)
      ) {
        if (notify) {
          showNotice({
            tone: 'warning',
            title: 'Splat is still loading',
            message: 'Wait for the splat to finish loading before saving.',
          });
        }
        return;
      }
      const blockSave = (message: string, title: string, hint: string) => {
        setSaveError(message);
        if (notify) showNotice({ tone: 'warning', title, message, hint });
      };
      if (sourceDirty) {
        blockSave(
          'Compile the MJCF draft before saving.',
          'Compile before saving',
          'Compile the draft in the MJCF panel (or discard it), then save again.',
        );
        return;
      }
      const name = sceneName.trim();
      if (!name) {
        blockSave(
          'Enter a scene name before saving.',
          'Name the scene',
          'Type a name in the scene name field in the toolbar, then save again.',
        );
        return;
      }
      if (currentHomePoseError) {
        blockSave(
          currentHomePoseError,
          'Home pose is invalid',
          'Fix or clear the home pose in the joint pose panel, then save again.',
        );
        return;
      }

      setSaving(true);
      setSaveError(null);
      let prepared: PreparedScene | null = null;
      try {
        prepared = await prepareScenePersistence(name);
        const saved = activeSceneId
          ? await updateScene(activeSceneId, prepared.input)
          : await createScene(prepared.input);
        applyPersistedRuntimeState(prepared);
        setActiveSceneId(saved.id);
        setSceneCreatedAt(saved.createdAt);
        setSceneName(saved.name);
        markSaved(prepared.xml);
        setSavedHomePose(homePose ? { ...homePose } : null);
        setHomePoseStatus(null);
        recordSceneRevision(projectId, saved.id, saved.name, prepared.xml, {
          homePose: homePose ? { version: 1, jointPositions: { ...homePose } } : null,
          backdrop: prepared.backdrop,
        });
        setRevisionRefreshKey((value) => value + 1);
        if (!activeSceneId) {
          // The splat's cache key and clear-on-scene-switch check are both keyed off
          // `scene:${id}`, but a brand-new scene only gets that id right here — without
          // this, the very next render (now with a real sceneId) looks like a scene
          // switch and wipes the splat that was just uploaded into this same session.
          const savedSplat = useEditorStore.getState().splatFile;
          const { splatSrc: currentSplatSrc, splatOrigin: currentOrigin } =
            useEditorStore.getState();
          if (currentSplatSrc) {
            suppressSplatClearRef.current = true;
            setSplatSceneKey(`scene:${saved.id}`);
            if (savedSplat && currentOrigin) {
              if (savedSplat.runtime.checksum === useEditorStore.getState().splatAsset?.hash) {
                deleteCachedSplat(saved.id).catch(() => {});
              } else {
                saveCachedSplat(saved.id, {
                  file: savedSplat.file,
                  hash: savedSplat.runtime.checksum,
                  calibration: useEditorStore.getState().splatCalibration,
                  origin: currentOrigin,
                  createdAt: saved.createdAt ?? new Date().toISOString(),
                }).catch(() => {});
              }
            }
          }
          router.replace(`/projects/${projectId}/scenes/${saved.id}`);
        }
        return saved;
      } catch (reason) {
        const currentXml = useEditorStore.getState().xml;
        if (prepared && prepared.xml !== currentXml) loadScene(currentXml, sceneName);
        const message = reason instanceof Error ? reason.message : 'The scene could not be saved.';
        setSaveError(message);
        if (notify) {
          showNotice({
            tone: 'error',
            title: 'Scene not saved',
            message,
            hint: 'Your changes are still in the editor. Fix the problem and save again.',
          });
        }
      } finally {
        setSaving(false);
      }
    },
    [
      showNotice,
      activeSceneId,
      applyPersistedRuntimeState,
      currentHomePoseError,
      homePose,
      loadScene,
      markSaved,
      prepareScenePersistence,
      projectId,
      router,
      saving,
      sceneName,
      setSplatSceneKey,
      sourceDirty,
      status,
    ],
  );

  const openTemplateDialog = useCallback(() => {
    if (!projectId || status !== 'ready' || sourceDirty || saving || currentHomePoseError) return;
    setTemplateName(sceneName.trim());
    setTemplateError(null);
    setTemplateDialogOpen(true);
  }, [currentHomePoseError, projectId, saving, sceneName, sourceDirty, status]);

  const saveAsTemplate = useCallback(async () => {
    if (!projectId || status !== 'ready' || sourceDirty || saving) return;
    const name = templateName.trim();
    if (!name) {
      setTemplateError('Enter a template name before saving.');
      return;
    }
    if (currentHomePoseError) {
      setTemplateError(currentHomePoseError);
      return;
    }

    setSaving(true);
    setTemplateError(null);
    setSaveError(null);
    let prepared: PreparedScene | null = null;
    try {
      prepared = await prepareScenePersistence(name);
      await createScene({ ...prepared.input, project: null, isTemplate: true });
      applyPersistedRuntimeState(prepared);
      setTemplateDialogOpen(false);
    } catch (reason) {
      const currentXml = useEditorStore.getState().xml;
      if (prepared && prepared.xml !== currentXml) loadScene(currentXml, sceneName);
      const message =
        reason instanceof Error ? reason.message : 'The scene template could not be saved.';
      setTemplateError(message);
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  }, [
    applyPersistedRuntimeState,
    currentHomePoseError,
    loadScene,
    prepareScenePersistence,
    projectId,
    saving,
    sceneName,
    sourceDirty,
    status,
    templateName,
  ]);

  const runAutosave = useEffectEvent(() => {
    if (documentDirty && !sourceDirty && !saving) save();
  });

  useEffect(() => {
    if (!projectId) return;
    const interval = window.setInterval(() => {
      runAutosave();
    }, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [projectId]);

  const restoreRevision = useCallback(
    (revision: SceneRevision) => {
      if (
        documentDirty &&
        !window.confirm('Discard current changes and restore this local revision?')
      ) {
        return;
      }
      if (!applyCompiledXml(revision.xml, revision.name, 'replace')) {
        setSaveError('MuJoCo rejected this local revision.');
        return;
      }
      markUnsaved();
      // The revision's heightfield and body pose were derived with its own calibration: restore
      // that calibration and origin with them when the same scan is loaded, so the rendered splat
      // and its heightfield agree.
      const backdrop = parseBackdrop(revision.backdrop);
      if (
        backdrop &&
        splatPointsRef.current.length &&
        useEditorStore.getState().splatFile?.runtime.checksum === backdrop.hash
      ) {
        setSplatBackdrop({ calibration: backdrop.calibration, origin: backdrop.origin });
      }
      if (revision.homePose) {
        const restoredPose = { ...revision.homePose.jointPositions };
        setResetPose(restoredPose);
        setHomePose(restoredPose);
        setSavedHomePose(restoredPose);
        setHomePoseStatus(null);
      } else {
        clearResetPose();
        setHomePose(null);
        setSavedHomePose(null);
        setHomePoseStatus(null);
      }
      resetTextureState(
        revision.xml,
        [...stagedRuntimeFiles.current.values()],
        initialAssets ?? [],
      );
      setSceneName(revision.name);
      setSaveError(null);
      setRightPanel('inspector');
    },
    [
      applyCompiledXml,
      clearResetPose,
      documentDirty,
      initialAssets,
      markUnsaved,
      resetTextureState,
      setResetPose,
      setSplatBackdrop,
    ],
  );

  const showFailure = useCallback(
    (title: string, reason: unknown, fallback: string) =>
      showNotice(noticeFromError(title, reason, fallback)),
    [showNotice],
  );

  /** Compile failure notice carrying MuJoCo's own compiler message. */
  const showCompileFailure = useCallback(
    (title: string, message: string, hint: string) => {
      const compilerError = getLastLoadError();
      showNotice({
        tone: 'error',
        title,
        message,
        details: compilerError ? compilerError.split('\n').filter(Boolean) : undefined,
        detailsLabel: 'MuJoCo compiler',
        hint,
      });
    },
    [getLastLoadError, showNotice],
  );

  const exportArchive = useCallback(async () => {
    if (status !== 'ready' || archiveBusy) return;
    if (sourceDirty) {
      showNotice({
        tone: 'warning',
        title: 'Compile before exporting',
        message: 'The MJCF panel has changes that are not compiled yet.',
        hint: 'Compile the draft in the MJCF panel (or discard it), then export again.',
      });
      return;
    }
    // The loaded splat travels with its calibration; its heightfield and body are in the MJCF.
    // A splat that is still loading or failed to load would be dropped silently, so wait for it.
    const splat = useEditorStore.getState();
    const splatReady = Boolean(splat.splatSrc && splat.splatFile && splat.splatStatus === 'ready');
    if (hasSplatBackdrop(xml) && !splatReady) {
      showNotice({
        tone: 'warning',
        title: 'Splat backdrop not loaded',
        message:
          'The splat backdrop is still loading or failed to load, so the ZIP would leave it out.',
        hint: 'Wait for "Splat ready" in the Splat tab, or upload the PLY again (or remove the splat), then export.',
      });
      return;
    }
    setArchiveBusy(true);
    setSaveError(null);
    try {
      const blob = await exportScenePackage(
        xml,
        sceneName,
        [...stagedRuntimeFiles.current.values()],
        {
          splat:
            splat.splatFile && splatReady
              ? {
                  filename: splat.splatFile.filename,
                  bytes: splat.splatFile.runtime.bytes,
                  calibration: splat.splatCalibration,
                  origin: splat.splatOrigin,
                }
              : null,
        },
      );
      downloadSceneArchive(blob, scenePackageFilename(sceneName));
    } catch (reason) {
      showFailure('Scene export failed', reason, 'The scene ZIP could not be exported.');
    } finally {
      setArchiveBusy(false);
    }
  }, [archiveBusy, sceneName, showFailure, showNotice, sourceDirty, status, xml]);

  const exportXml = useCallback(() => {
    if (status !== 'ready' || sourceDirty || archiveBusy) return;
    downloadSceneXml(xml, xmlFilename(sceneName));
  }, [archiveBusy, sceneName, sourceDirty, status, xml]);

  const importPackage = useCallback(
    async (file: File, entrypoint?: string) => {
      setArchiveBusy(true);
      setSaveError(null);
      try {
        const imported = await importScenePackage(file, { entrypoint });
        stageFiles(imported.runtimeFiles);
        if (!applyCompiledXml(imported.xml, imported.sceneName, 'replace')) {
          showCompileFailure(
            'Scene import failed',
            `MuJoCo rejected the imported scene (${imported.entrypoint}). Your open scene was not changed.`,
            'Fix the model so it loads in MuJoCo, then import the ZIP again.',
          );
          return;
        }
        stagedRuntimeFiles.current = new Map(
          imported.runtimeFiles.map((runtimeFile) => [runtimeFile.path, runtimeFile]),
        );
        setGenerationRuntimeFiles([...imported.runtimeFiles]);
        localRuntimePaths.current = new Set(
          imported.runtimeFiles.map((runtimeFile) => runtimeFile.path),
        );
        uploadedRuntimeAssets.current.clear();
        discardSplat();
        setSplatAsset(null);
        uploadedSplatRef.current = null;
        if (imported.splat) {
          // Restore like a saved scene: keep the imported body pose and the saved calibration.
          const { filename, bytes, sha256, calibration, origin } = imported.splat;
          const file = new Blob([bytes as Uint8Array<ArrayBuffer>]);
          restoringSplatRef.current = { calibration, origin: origin ?? [0, 0, 0] };
          replaceSplatFile({
            file,
            filename,
            runtime: { path: localSplatPath(bytes), bytes, checksum: sha256, kind: 'splat' },
          });
          setSplatSrc(URL.createObjectURL(file), { calibration, sceneKey: runtimeSceneKey });
        }
        markUnsaved();
        resetTextureState(imported.xml, imported.runtimeFiles, []);
        setSceneName(imported.sceneName);
        setActiveSceneId(null);
        resetHomePoseState();
        setRightPanel('inspector');
        setLeftPanel('scene');
        if (imported.placeholderTextures.length) {
          showNotice({
            tone: 'warning',
            title: 'Scene imported with missing textures',
            message:
              'Some texture images could not be loaded. They were replaced with a flat placeholder, so surfaces that use them appear untextured.',
            details: imported.placeholderTextures,
            detailsLabel: 'Replaced textures',
            hint: 'To restore them, add the images (PNG or JPG) to the ZIP and import it again.',
          });
        }
      } catch (reason) {
        if (reason instanceof ScenePackageEntrypointError) {
          setPendingPackageImport({ file, candidates: reason.candidates });
          return;
        }
        showFailure('Scene import failed', reason, 'The scene ZIP could not be imported.');
      } finally {
        setArchiveBusy(false);
      }
    },
    [
      showNotice,
      resetHomePoseState,
      applyCompiledXml,
      discardSplat,
      markUnsaved,
      replaceSplatFile,
      resetTextureState,
      runtimeSceneKey,
      setSplatAsset,
      setSplatSrc,
      showCompileFailure,
      showFailure,
      stageFiles,
    ],
  );

  const importArchive = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      if (documentDirty && !window.confirm('Discard unsaved changes and import this scene ZIP?'))
        return;
      await importPackage(file);
    },
    [documentDirty, importPackage],
  );

  const importXml = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      if (documentDirty && !window.confirm('Discard unsaved changes and import this MJCF file?')) {
        return;
      }

      setArchiveBusy(true);
      setSaveError(null);
      try {
        const importedXml = await file.text();
        const importedName = file.name.replace(/\.[^.]+$/, '').trim() || 'Imported scene';
        const requiredFiles = externalFileReferences(importedXml);
        if (requiredFiles.length) {
          showNotice({
            tone: 'error',
            title: 'MJCF import needs its files',
            message: `${file.name} references ${requiredFiles.length === 1 ? 'a file' : `${requiredFiles.length} files`} that a single XML import cannot include. Your open scene was not changed.`,
            details: requiredFiles,
            detailsLabel: 'Required files',
            hint: 'Zip the folder that contains this XML and its meshes, textures, and included XML files, then use Import > Scene ZIP.',
          });
          return;
        }
        if (!applyCompiledXml(importedXml, importedName, 'replace')) {
          showCompileFailure(
            'MJCF import failed',
            `MuJoCo rejected ${file.name}. Your open scene was not changed.`,
            'Fix the reported problem in the XML, then import it again.',
          );
          return;
        }
        stagedRuntimeFiles.current.clear();
        setGenerationRuntimeFiles([]);
        localRuntimePaths.current.clear();
        uploadedRuntimeAssets.current.clear();
        discardSplat();
        setSplatAsset(null);
        markUnsaved();
        resetTextureState(importedXml, [], []);
        setSceneName(importedName);
        setActiveSceneId(null);
        resetHomePoseState();
        setRightPanel('inspector');
        setLeftPanel('scene');
      } catch (reason) {
        showFailure('MJCF import failed', reason, 'The MJCF file could not be imported.');
      } finally {
        setArchiveBusy(false);
      }
    },
    [
      showNotice,
      resetHomePoseState,
      applyCompiledXml,
      discardSplat,
      documentDirty,
      markUnsaved,
      resetTextureState,
      setSplatAsset,
      showCompileFailure,
      showFailure,
    ],
  );

  const handleSplatFileSelected = useCallback(
    async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = await sha256Hex(bytes);
      const previous = useEditorStore.getState().splatSrc;
      if (previous) URL.revokeObjectURL(previous);
      restoringSplatRef.current = null;
      detectSplatOrientationRef.current = true;
      setSplatOrientationNote(null);
      setTableNote(null);
      splatPointsRef.current = [];
      const saved = [useEditorStore.getState().splatAsset, uploadedSplatRef.current].find(
        (candidate) => !!candidate && candidate.hash === hash && !candidate.unreadable,
      );
      replaceSplatFile({
        file,
        filename: file.name,
        runtime: {
          path: saved?.path ?? localSplatPath(bytes),
          bytes,
          checksum: hash,
          kind: 'splat',
        },
      });
      // A new scan starts uncalibrated (its orientation is detected on load); its backdrop body is
      // re-created at the aligned origin.
      setSplatSrc(URL.createObjectURL(file), {
        calibration: DEFAULT_SPLAT_CALIBRATION,
        sceneKey: runtimeSceneKey,
      });
    },
    [replaceSplatFile, runtimeSceneKey, setSplatSrc],
  );

  const handleSplatStatusChange = useCallback(
    (status: 'idle' | 'loading' | 'ready' | 'error') => {
      // 'ready' is reported by handleSplatLoad once the backdrop has compiled into the scene.
      if (status !== 'ready') setSplatStatus(status);
    },
    [setSplatStatus],
  );

  const handleSplatError = useCallback(
    (err: Error) => {
      setSplatStatus('error', err.message);
    },
    [setSplatStatus],
  );

  const cacheSplat = useCallback(
    (calibration: SplatCalibration, origin: Vec3Tuple) => {
      const current = useEditorStore.getState().splatFile;
      if (!activeSceneId || !current || !sceneCreatedAt) return;
      const savedAsset = useEditorStore.getState().splatAsset;
      const savedHash = savedAsset?.unreadable ? undefined : savedAsset?.hash;
      if (!shouldCacheSplat(current.runtime.checksum, savedHash)) {
        deleteCachedSplat(activeSceneId).catch(() => {});
        return;
      }
      saveCachedSplat(activeSceneId, {
        file: current.file,
        hash: current.runtime.checksum,
        calibration,
        origin,
        createdAt: sceneCreatedAt,
      }).catch(() => {});
    },
    [activeSceneId, sceneCreatedAt],
  );

  // Re-derives the heightfield for `calibration` and commits it with `baseXml`. A recalibration
  // shifts the body by the change of alignment origin so the scan stays put; a fold (`keepPosition`)
  // keeps the body position, since the folded pose already renders the splat in the same place.
  // Splat tables are ordinary geoms and stay where they are.
  const commitBackdrop = useCallback(
    (baseXml: string, calibration: SplatCalibration, keepPosition = false): string | null => {
      const points = splatPointsRef.current;
      if (!points.length) return 'Wait for the splat to finish loading.';
      const authored = splatBackdropBodyPosition(baseXml);
      const derived = deriveSplatBackdrop(points, calibration);
      const bodyPosition = !authored
        ? derived.origin
        : keepPosition
          ? authored
          : recalibratedBodyPosition(
              authored,
              useEditorStore.getState().splatOrigin ?? derived.origin,
              derived.origin,
              backdropWorldQuat(getSimulation()) ?? undefined,
            );
      const nextXml = insertSplatBackdrop(baseXml, derived.heightfield, { bodyPosition });
      if (!nextXml) return 'Could not update the splat backdrop.';
      if (!applyCompiledXml(nextXml, sceneName, 'incremental')) {
        const detail = getLastLoadError();
        return `MuJoCo rejected the recalibrated backdrop${detail ? `: ${detail}` : '.'}`;
      }
      setSplatBackdrop({ calibration, origin: derived.origin });
      cacheSplat(calibration, derived.origin);
      return null;
    },
    [applyCompiledXml, cacheSplat, getLastLoadError, getSimulation, sceneName, setSplatBackdrop],
  );

  // Splat points arrive in raw PLY coordinates. Derive the collision heightfield in the
  // backdrop body frame and merge it into the live MJCF. A restored splat keeps the body pose
  // already in the MJCF; a new one gets a fresh body at the aligned origin.
  const handleSplatLoad = useCallback(
    (points: SplatPoint[]) => {
      splatPointsRef.current = points;
      const restoring = restoringSplatRef.current;
      restoringSplatRef.current = null;
      let calibration = restoring?.calibration ?? useEditorStore.getState().splatCalibration;
      const currentXml = useEditorStore.getState().xml;
      if (!restoring && detectSplatOrientationRef.current) {
        // PLYs from other tools are often y-up or y-down: pick the up axis and level the floor.
        detectSplatOrientationRef.current = false;
        const detected = detectSplatOrientation(points, calibration);
        if (!detected.ok) {
          setSplatOrientationNote({
            ok: false,
            message:
              'No floor was found to orient this scan. Set Up axis and Tilt X/Y, or rotate the backdrop with the gizmo; tilt is applied to the splat calibration.',
          });
        } else {
          const next = detected.calibration;
          const changed =
            next.upAxis !== calibration.upAxis ||
            next.tiltX !== calibration.tiltX ||
            next.tiltY !== calibration.tiltY;
          calibration = next;
          setSplatOrientationNote({
            ok: true,
            message: changed
              ? `Oriented on its floor: Up axis ${next.upAxis}, tilt X ${next.tiltX}°, tilt Y ${next.tiltY}°.`
              : 'The scan is z-up and level.',
          });
        }
      }
      const keepBody = Boolean(restoring?.origin) && splatBackdropBodyPosition(currentXml) !== null;
      const derived = deriveSplatBackdrop(points, calibration);
      const origin = restoring?.origin ?? derived.origin;
      const nextXml = insertSplatBackdrop(
        currentXml,
        derived.heightfield,
        keepBody ? {} : { bodyPosition: origin, resetOrientation: true },
      );
      if (!nextXml) {
        setSplatStatus('error', 'Could not add the splat backdrop to the scene.');
        return;
      }
      if (
        !splatBackdropHeightfieldMatches(currentXml, nextXml) &&
        !applyCompiledXml(nextXml, sceneName, 'incremental')
      ) {
        setSplatStatus(
          'error',
          `MuJoCo rejected the splat backdrop. ${getLastLoadError() ?? ''}`.trim(),
        );
        return;
      }
      setSplatBackdrop({ calibration, origin });
      cacheSplat(calibration, origin);
      setSplatStatus('ready');
    },
    [applyCompiledXml, cacheSplat, getLastLoadError, sceneName, setSplatBackdrop, setSplatStatus],
  );

  // Recalibration replaces only the heightfield. The body keeps the user's orientation and is
  // offset by the change of alignment origin (expressed in the body frame), so a scan the user
  // placed stays where it was instead of snapping back to the default alignment.
  const handleSplatCalibrationChange = useCallback(
    (calibration: SplatCalibration): string | null =>
      commitBackdrop(useEditorStore.getState().xml, calibration),
    [commitBackdrop],
  );

  // A heightfield is only valid while the backdrop body's z axis is world up, so the body only
  // moves and yaws. Every edit of its pose (gizmo, Inspector, MJCF source) comes through here:
  // compile the candidate, then fold any tilt into the calibration. Returns false when MuJoCo
  // rejects the candidate (the caller reports it).
  const applyBackdropPose = useCallback(
    (candidateXml: string): boolean => {
      if (!applyCompiledXml(candidateXml, sceneName, 'history')) return false;
      const { splatCalibration: calibration, splatSrc } = useEditorStore.getState();
      const pose = splatSrc ? backdropWorldQuat(getSimulation()) : null;
      const leveled = pose ? levelBackdropPose(pose, calibration) : null;
      const folded =
        leveled && leveled.calibration !== calibration && backdropBodyNode?.kind === 'body'
          ? setNodeAttribute(
              candidateXml,
              backdropBodyNode,
              'euler',
              yawEuler(leveled.bodyQuat, candidateXml),
            )
          : null;
      const error = folded && leveled && commitBackdrop(folded, leveled.calibration, true);
      if (!folded || error) commitXml(candidateXml);
      if (error) {
        showNotice({ tone: 'warning', title: 'Backdrop tilt not leveled', message: error });
      }
      return true;
    },
    [
      applyCompiledXml,
      backdropBodyNode,
      commitBackdrop,
      commitXml,
      getSimulation,
      sceneName,
      showNotice,
    ],
  );

  const handleBackdropInspectorRotation = useCallback(
    (value: string) => {
      if (backdropBodyNode?.kind !== 'body') return;
      const attribute = value.trim().split(/\s+/).length === 4 ? 'quat' : 'euler';
      const next = setNodeAttribute(xml, backdropBodyNode, attribute, value);
      if (next) applyBackdropPose(next);
    },
    [applyBackdropPose, backdropBodyNode, xml],
  );

  // Add table: a camera-hidden box over the middle of the scan with its top `SPLAT_TABLE_HEIGHT`
  // above the scanned floor, selected with the gizmo so it can be dragged onto the scanned table.
  const addSplatTable = useCallback((): string | null => {
    const { splatOrigin: origin, splatCalibration: calibration } = useEditorStore.getState();
    const pose = backdropWorldPose(getSimulation());
    if (!origin || !pose) return 'Wait for the scan to finish loading.';
    const [x, y, z] = backdropPivot(origin, calibration.level);
    const { position: t, rotation: r } = pose;
    const floor = [0, 1, 2].map(
      (row) => t[row] + r[row * 3] * x + r[row * 3 + 1] * y + r[row * 3 + 2] * z,
    );
    const inserted = insertSplatTable(useEditorStore.getState().xml, [
      floor[0],
      floor[1],
      floor[2] + SPLAT_TABLE_HEIGHT,
    ]);
    if (!inserted) return 'Could not add the table.';
    if (!applyCompiledXml(inserted.xml, sceneName, 'incremental')) {
      const detail = getLastLoadError();
      return `MuJoCo rejected the table${detail ? `: ${detail}` : '.'}`;
    }
    pendingPlacedNode.current = { kind: 'geom', name: inserted.name, edit: true };
    setRightPanel('inspector');
    setTableNote(`Added ${inserted.name}. Move and resize the box to cover the scanned table.`);
    return null;
  }, [applyCompiledXml, getLastLoadError, getSimulation, sceneName]);

  // Match height to scan: sets the table's top to the scan's surface measured under it, in one
  // undo step. Objects resting on the table move with its top, so they are neither left inside
  // the table nor floating above it.
  const matchTableHeight = useCallback(
    (name: string): string | null => {
      const points = splatPointsRef.current;
      if (!points.length) return 'Wait for the scan to finish loading.';
      const simulation = getSimulation();
      const pose = backdropWorldPose(simulation);
      const table = simulationSplatTables(simulation).find((candidate) => candidate.name === name);
      if (!pose || !table) return 'Wait for the scene to finish loading.';
      const top = measureScanSurface(points, useEditorStore.getState().splatCalibration, pose, {
        center: table.center,
        half: [table.size[0] / 2, table.size[1] / 2],
        yaw: table.yaw,
        top: table.top,
      });
      if (top === null) {
        return `No scanned surface was found under ${name} within 25 cm of its top. Move it over the scanned table first.`;
      }
      const lift = top - table.top;
      const millimetres = Math.round(Math.abs(lift) * 1000);
      if (millimetres === 0) {
        setTableNote(`${name} already matches the scan (top at ${top.toFixed(3)} m).`);
        return null;
      }
      const nextXml = shiftWorldElements(
        useEditorStore.getState().xml,
        [name, ...table.resting],
        lift,
      );
      if (!applyCompiledXml(nextXml, sceneName, 'incremental')) {
        const detail = getLastLoadError();
        return `MuJoCo rejected the table${detail ? `: ${detail}` : '.'}`;
      }
      const moved = `${name} moved ${millimetres} mm ${lift > 0 ? 'up' : 'down'} to the scan (top at ${top.toFixed(3)} m)`;
      setTableNote(
        table.resting.length ? `${moved}; ${table.resting.join(', ')} moved with it.` : `${moved}.`,
      );
      return null;
    },
    [applyCompiledXml, getLastLoadError, getSimulation, sceneName],
  );

  // Raises objects that start inside a splat table so their lowest point rests on its top.
  const dropOntoTable = useCallback(
    (names?: readonly string[]) => {
      let nextXml = useEditorStore.getState().xml;
      for (const { name, depth } of objectsInsideTables(simulationSplatTables(getSimulation()))) {
        if (!names || names.includes(name)) nextXml = shiftWorldElements(nextXml, [name], depth);
      }
      applyDocument(nextXml);
    },
    [applyDocument, getSimulation],
  );

  // Auto level fits the floor plane on the loaded points and applies the leveled orientation as
  // an ordinary recalibration (so the user's placement of the backdrop is kept).
  const handleSplatAutoLevel = useCallback((): { ok: boolean; message: string } => {
    const points = splatPointsRef.current;
    if (!points.length) return { ok: false, message: 'Wait for the splat to finish loading.' };
    const current = useEditorStore.getState().splatCalibration;
    const result = autoLevelCalibration(points, current);
    if (!result.ok) return { ok: false, message: result.message };
    const fit = `Floor plane fit: ${Math.round(result.inlierRatio * 100)}% of the lowest points.`;
    const next = result.calibration;
    if (
      next.upAxis === current.upAxis &&
      next.tiltX === current.tiltX &&
      next.tiltY === current.tiltY
    ) {
      return { ok: true, message: `${fit} The splat is already level.` };
    }
    const error = handleSplatCalibrationChange(next);
    return error
      ? { ok: false, message: error }
      : {
          ok: true,
          message: `${fit} Up axis ${next.upAxis}, tilt X ${next.tiltX}°, tilt Y ${next.tiltY}°.`,
        };
  }, [handleSplatCalibrationChange]);

  const handleClearSplat = useCallback(() => {
    const currentXml = useEditorStore.getState().xml;
    const nextXml = removeSplatBackdrop(currentXml);
    if (nextXml !== currentXml) applyCompiledXml(nextXml, sceneName, 'incremental');
    discardSplat();
    if (activeSceneId) deleteCachedSplat(activeSceneId).catch(() => {});
  }, [activeSceneId, applyCompiledXml, discardSplat, sceneName]);

  /** Raw PLY -> backdrop body rotation of the current calibration ([w, x, y, z]). */
  const { upAxis: splatUpAxis, tiltX: splatTiltX, tiltY: splatTiltY } = splatCalibration;
  const splatRotation = useMemo(
    () => calibrationRotation({ upAxis: splatUpAxis, tiltX: splatTiltX, tiltY: splatTiltY }),
    [splatTiltX, splatTiltY, splatUpAxis],
  );

  /** Worker runtime files: staged MJCF assets plus the splat PLY with its calibration. */
  const workerRuntimeFiles = useMemo(() => {
    const files = generationRuntimeFiles.filter((file) => file.kind !== 'splat');
    return splatFile && splatSrc && splatOrigin
      ? [...files, { ...splatFile.runtime, splatScale: splatCalibration.scale, splatRotation }]
      : files;
  }, [
    generationRuntimeFiles,
    splatCalibration.scale,
    splatFile,
    splatOrigin,
    splatRotation,
    splatSrc,
  ]);

  const addCamera = useCallback(() => {
    const viewportPose = cameraPoseRef.current;
    const position: readonly [number, number, number] = viewportPose
      ? mujocoPointFromThree(viewportPose.position)
      : [2.4, -2.4, 1.8];
    const target: readonly [number, number, number] = viewportPose
      ? mujocoPointFromThree(viewportPose.target)
      : [0, 0, 0.5];
    const insertion = insertCamera(xml, {
      name: 'camera',
      position,
      target,
      fovy: viewportPose?.fovy ?? 45,
    });
    if (!insertion) {
      setSaveError('Could not add a camera to the current scene.');
      return;
    }
    if (!applyCompiledXml(insertion.xml, sceneName, 'incremental')) {
      setSaveError('MuJoCo rejected the new camera.');
      return;
    }
    pause();
    setSaveError(null);
    pendingPlacedNode.current = { kind: 'camera', name: insertion.nodeName };
    setRightPanel('inspector');
    setLeftPanel('scene');
  }, [applyCompiledXml, pause, sceneName, xml]);

  const mountCamera = useCallback(() => {
    const node = graph && selectedIds.length === 1 ? graph.nodes[selectedIds[0]] : null;
    const simulation = getSimulation();
    if (!graph || !node || (node.kind !== 'body' && node.kind !== 'site') || !simulation) {
      setSaveError('Select one body or site before mounting a camera.');
      return;
    }
    const pose = mountedCameraPoseFor(simulation, graph, node);
    if (!pose) {
      setSaveError('The selected node does not have a mountable body frame.');
      return;
    }
    const insertion = insertMountedCamera(xml, {
      name: 'camera',
      parent: pose.body,
      position: pose.position,
      rotation: pose.rotation,
      fovy: 45,
    });
    if (!insertion) {
      setSaveError('Could not mount a camera to the selected node.');
      return;
    }
    if (!applyCompiledXml(insertion.xml, sceneName, 'incremental')) {
      setSaveError('MuJoCo rejected the mounted camera.');
      return;
    }
    pause();
    setPreviewCameraId(null);
    setSaveError(null);
    pendingPlacedNode.current = { kind: 'camera', name: insertion.nodeName };
    setRightPanel('inspector');
    setLeftPanel('scene');
  }, [applyCompiledXml, getSimulation, graph, pause, sceneName, selectedIds, xml]);

  const addLight = useCallback(() => {
    const insertion = insertLight(xml, {
      name: 'light',
      type: 'directional',
      position: [2, -2, 3],
      direction: [-0.45, 0.45, -1],
    });
    if (!insertion) {
      setSaveError('Could not add a light to the current scene.');
      return;
    }
    if (!applyCompiledXml(insertion.xml, sceneName, 'incremental')) {
      setSaveError('MuJoCo rejected the new light.');
      return;
    }
    pause();
    setSaveError(null);
    setPreviewCameraId(null);
    pendingPlacedNode.current = { kind: 'light', name: insertion.nodeName };
    setRightPanel('inspector');
    setLeftPanel('scene');
  }, [applyCompiledXml, pause, sceneName, xml]);

  const previewCamera = useCallback((node: { id: string }) => {
    setPreviewCameraId((current) => (current === node.id ? null : node.id));
  }, []);

  const applyHistory = useCallback(
    (entry: ReturnType<typeof undo>) => {
      if (entry) applyCompiledXml(entry.xml, sceneName, 'history');
    },
    [applyCompiledXml, sceneName],
  );

  const mutateSelected = useCallback(
    (mutation: typeof deleteNode) => {
      const node = graph?.nodes[selectedIds[0]];
      if (!node || selectedIds.length !== 1) return;
      const nextXml =
        mutation === deleteNode && node.kind !== 'camera' && robotInstancePrefixForNode(xml, node)
          ? deleteRobotInstance(xml, node)
          : mutation(xml, node);
      if (nextXml) {
        if (!applyCompiledXml(nextXml, sceneName, 'incremental')) {
          showCompileFailure(
            'Could not update scene',
            'MuJoCo rejected this edit. The object and working scene have been kept.',
            'Review the compiler details before trying again.',
          );
          return;
        }
        clearSelection();
      }
    },
    [applyCompiledXml, clearSelection, graph, sceneName, selectedIds, showCompileFailure, xml],
  );

  const onTransformCommit = useCallback(
    (commit: TransformCommit) => {
      const { node } = commit;
      let nextXml: string | null = null;
      if (commit.mode === 'translate') {
        nextXml = setNodeAttribute(xml, node, 'pos', commit.position);
      } else if (commit.mode === 'rotate') {
        if (node.kind === 'camera') {
          nextXml = setNodeAttribute(xml, node, 'quat', commit.quaternion);
        } else {
          const toUnit = compilerAngleUnit(xml) === 'radian' ? 1 : 180 / Math.PI;
          nextXml = setNodeAttribute(
            xml,
            node,
            'euler',
            commit.rotation.map((value) => value * toUnit),
          );
          // Rotating about a pivot other than the origin moves the origin as well.
          if (nextXml && commit.pivoted) {
            nextXml = setNodeAttribute(nextXml, node, 'pos', commit.position);
          }
        }
      } else if (node.kind === 'geom') {
        nextXml = setNodeAttribute(
          xml,
          node,
          'size',
          node.size.map((value, index) => value * commit.scale[index]),
        );
      } else if (node.kind === 'body') {
        const simulation = getSimulation();
        const factor = commit.scale[0];
        if (simulation && Number.isFinite(factor) && factor > 0) {
          // Scaling happens about the body origin; raise it so its bottom stays on its support.
          const bottom = currentWorldBounds(simulation, node.name).low[2];
          const origin = simulation.bodyPositions[simulation.bodyIndex(node.name) * 3 + 2];
          nextXml = scaleObject(xml, node.name, factor, (bottom - origin) * (1 - factor));
        }
      }
      if (!nextXml) return;
      if (node.kind === 'body' && isSplatBackdropNode(node)) applyBackdropPose(nextXml);
      else applyDocument(nextXml);
    },
    [applyBackdropPose, applyDocument, getSimulation, xml],
  );

  const addObjectModelToScene = useCallback(
    async (
      conversion: Obj2MjcfConversion,
      position: readonly [number, number, number] = [0, 0, 0.5],
      assertCurrent?: () => void,
    ) => {
      if (status !== 'ready') throw new Error('Wait for the MuJoCo runtime to finish loading.');
      if (!conversion.files.length) {
        throw new Error('obj2mjcf did not return any mesh or texture files for this object.');
      }

      const meshFiles = new Map<string, string>();
      const runtimeFiles: RuntimeFile[] = await Promise.all(
        conversion.files.map(async (filename) => {
          // Keep the exact obj2mjcf filename so this path still resolves on scene reload
          // (downloadSceneRuntimeFiles re-fetches it from the server by this same name).
          const runtimePath = `objects/${conversion.assetId}/${filename}`;
          meshFiles.set(filename, runtimePath);
          let fileUrl = '';
          for (const character of obj2mjcfFileUrl(conversion.assetId, filename)) {
            let allowedCharacter = '';
            for (const allowed of URL_CHARS) {
              if (allowed === character) {
                allowedCharacter = allowed;
                break;
              }
            }
            if (!allowedCharacter)
              throw new Error(`Could not download the generated "${filename}".`);
            fileUrl += allowedCharacter;
          }
          const response = await fetch(fileUrl);
          if (!response.ok) throw new Error(`Could not download the generated "${filename}".`);
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (!bytes.byteLength) throw new Error(`The generated "${filename}" is empty.`);
          return {
            path: runtimePath,
            bytes,
            checksum:
              response.headers.get('etag') ??
              `${conversion.assetId}-${filename}-${bytes.byteLength}`,
          };
        }),
      );
      // insertRobotModel requires an <actuator> section even for a static/free object.
      const mjcf = conversion.mjcf.includes('<actuator')
        ? conversion.mjcf
        : conversion.mjcf.replace('</mujoco>', '<actuator/></mujoco>');

      const placement: RobotPlacement = {
        robotId: conversion.assetId,
        name: conversion.assetId,
        mjcf,
        meshFiles,
        position: [position[0], position[1], position[2]],
        rotation: [Math.SQRT1_2, Math.SQRT1_2, 0, 0],
      };
      assertCurrent?.();
      const insertion = insertRobotModel(useEditorStore.getState().xml, placement);
      if (!insertion) throw new Error('Could not add this object to the scene.');
      // Re-adding an already staged object reuses its paths; count each runtime path once.
      const candidateFiles = new Map(stagedRuntimeFiles.current);
      for (const file of runtimeFiles) candidateFiles.set(file.path, file);
      const usage = assertObjectSceneBudget(insertion.xml, [...candidateFiles.values()]);
      try {
        stageFiles(runtimeFiles);
        if (!applyCompiledXml(insertion.xml, sceneName, 'incremental')) {
          const detail = getLastLoadError();
          throw new Error(
            `MuJoCo rejected the converted object in the current scene${detail ? `: ${detail}` : '.'}`,
          );
        }
      } catch (error) {
        retainFiles(new Set(stagedRuntimeFiles.current.keys()));
        throw error;
      }
      for (const file of runtimeFiles) stagedRuntimeFiles.current.set(file.path, file);
      setGenerationRuntimeFiles([...stagedRuntimeFiles.current.values()]);
      console.info('Converted object scene budget', usage);

      // The viewport resolves texture URLs from this map, not from MuJoCo's own compiled
      // assets, so the new object's texture(s) must be merged in now rather than on next reload.
      const stagedFiles = [...stagedRuntimeFiles.current.values()];
      runtimeTextureUrls.current.sync(stagedFiles);
      setTextureUrlsByMaterial((current) => ({
        ...current,
        ...extractTextureUrlsFromMjcf(insertion.xml, stagedFiles, initialAssets ?? [], (path) =>
          runtimeTextureUrls.current.get(path),
        ),
      }));

      pause();
      setSaveError(null);
      pendingPlacedNode.current = { kind: 'body', name: insertion.bodyName };
      setRightPanel('inspector');
    },
    [
      applyCompiledXml,
      getLastLoadError,
      initialAssets,
      pause,
      retainFiles,
      sceneName,
      stageFiles,
      status,
    ],
  );

  const addAssetToScene = useCallback(
    async (
      asset: SceneAsset,
      placement?: PrimitiveObjectPlacement | MeshObjectPlacement,
      assertCurrent?: () => void,
    ) => {
      const objectModel = objectModelConversion(asset);
      if (objectModel) {
        await addObjectModelToScene(objectModel, placement?.position, assertCurrent);
        return;
      }

      if (asset.customSource) {
        const parsed = parseCustomGeomDefinition(asset.customSource);
        if (!parsed.definition) {
          throw new Error(
            `This saved custom shape is invalid: ${parsed.error ?? 'check its MuJoCo definition.'}`,
          );
        }
        assertCurrent?.();
        const insertion = insertCustomGeomObject(xml, parsed.definition);
        if (!insertion) throw new Error('Could not add this custom shape to the scene.');
        if (!applyCompiledXml(insertion.xml, sceneName, 'incremental')) {
          const detail = getLastLoadError();
          throw new Error(
            `MuJoCo rejected this saved custom shape${detail ? `: ${detail}` : '. Check its type, size, and attributes.'}`,
          );
        }

        pause();
        setPreviewAsset(null);
        pendingPlacedNode.current = { kind: insertion.nodeKind, name: insertion.nodeName };
        setRightPanel('inspector');
        return;
      }

      if (asset.primitive) {
        const primitivePlacement =
          placement && placement.rotation.length === 3
            ? (placement as PrimitiveObjectPlacement)
            : null;
        assertCurrent?.();
        const insertion = insertPrimitiveObject(xml, {
          name: asset.name,
          ...asset.primitive,
          position: primitivePlacement?.position ?? [0, 0, 0.5],
          rotation: primitivePlacement?.rotation ?? [0, 0, 0],
        });
        if (!insertion) throw new Error('Could not add this object to the scene.');
        if (!applyCompiledXml(insertion.xml, sceneName, 'incremental')) {
          const detail = getLastLoadError();
          throw new Error(
            `MuJoCo could not add this object to the scene${detail ? `: ${detail}` : '.'}`,
          );
        }

        pause();
        setPreviewAsset(null);
        pendingPlacedNode.current = { kind: 'body', name: insertion.bodyName };
        setRightPanel('inspector');
        return;
      }

      const meshPlacement =
        placement && placement.rotation.length === 4 ? (placement as MeshObjectPlacement) : null;
      const canonicalArtifact = artifactFor(asset.canonicalMesh);
      const collisionArtifact = artifactFor(asset.collisionMesh);
      const sourceFilename = asset.filename;
      const visualFilename = canonicalArtifact?.filename ?? sourceFilename;
      const collisionEnabled = asset.metadata?.collisionStrategy !== 'none';
      if (!visualFilename) {
        throw new Error('This object has no canonical mesh available for placement.');
      }

      if (!canonicalArtifact && !sourceFilename?.toLowerCase().endsWith('.stl')) {
        throw new Error('This object has no canonical STL mesh available for placement.');
      }

      const visualRuntimePath = canonicalArtifact
        ? `assets/${asset.id}/canonical/${sanitizedRuntimeFilename(visualFilename)}`
        : `assets/${asset.id}/${sanitizedRuntimeFilename(visualFilename)}`;
      const collisionRuntimePath = collisionEnabled
        ? collisionArtifact?.filename
          ? `assets/${asset.id}/collision/${sanitizedRuntimeFilename(collisionArtifact.filename)}`
          : visualRuntimePath
        : undefined;
      const visualCollection = canonicalArtifact ? 'asset-artifacts' : 'assets';
      const response = await fetch(
        `/api/${visualCollection}/file/${encodeURIComponent(visualFilename)}`,
      );
      if (!response.ok) throw new Error('Could not download this object. Try again.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const runtimeFiles: RuntimeFile[] = [
        {
          path: visualRuntimePath,
          bytes,
          checksum: response.headers.get('etag') ?? `${asset.id}-visual-${bytes.byteLength}`,
        },
      ];
      if (collisionEnabled && collisionArtifact?.filename && collisionRuntimePath) {
        const collisionResponse = await fetch(
          `/api/asset-artifacts/file/${encodeURIComponent(collisionArtifact.filename)}`,
        );
        if (!collisionResponse.ok) {
          throw new Error('Could not download the generated collision mesh. Try again.');
        }
        const collisionBytes = new Uint8Array(await collisionResponse.arrayBuffer());
        runtimeFiles.push({
          path: collisionRuntimePath,
          bytes: collisionBytes,
          checksum:
            collisionResponse.headers.get('etag') ??
            `${collisionArtifact.id}-collision-${collisionBytes.byteLength}`,
        });
      }
      assertCurrent?.();
      stageEditorFiles(runtimeFiles);

      const insertion = insertMeshAsset(xml, {
        assetId: String(asset.id),
        name: asset.name,
        visualFile: visualRuntimePath,
        ...(collisionRuntimePath ? { collisionFile: collisionRuntimePath } : {}),
        position: meshPlacement?.position ?? [0, 0, 0.5],
        rotation: meshPlacement?.rotation ?? [1, 0, 0, 0],
      });
      if (!insertion) throw new Error('Could not add this object to the scene.');
      if (!applyCompiledXml(insertion.xml, sceneName, 'incremental')) {
        const detail = getLastLoadError();
        throw new Error(
          `MuJoCo could not add this object to the scene${detail ? `: ${detail}` : '.'}`,
        );
      }

      pause();
      setPreviewAsset(null);
      pendingPlacedNode.current = { kind: 'body', name: insertion.bodyName };
      setRightPanel('inspector');
    },
    [
      addObjectModelToScene,
      applyCompiledXml,
      getLastLoadError,
      pause,
      sceneName,
      stageEditorFiles,
      xml,
    ],
  );

  const handleAssetDrop = useCallback(
    async (placement: MeshObjectPlacement) => {
      const asset = draggedAsset;
      setDraggedAsset(null);
      if (!asset) return;
      try {
        await addAssetToScene(asset, placement);
      } catch (reason) {
        setSaveError(reason instanceof Error ? reason.message : 'The object could not be placed.');
      }
    },
    [addAssetToScene, draggedAsset],
  );

  const applyMaterial = useCallback(
    async (asset: SceneAsset, face: BoxFace | null) => {
      const node = graph?.nodes[selectedIds[0]];
      if (!node || selectedIds.length !== 1 || (node.kind !== 'body' && node.kind !== 'geom')) {
        throw new Error('Select one body or visual object before applying a material.');
      }
      const material = asset.material;
      if (!material) throw new Error('This material is missing its appearance settings.');

      let textureFile: string | undefined;
      let textureUrl: string | undefined;
      if (material.texture?.filename) {
        const response = await fetch(
          `/api/assets/file/${encodeURIComponent(material.texture.filename)}`,
        );
        if (!response.ok) throw new Error('Could not download this material image. Try again.');
        const bytes = new Uint8Array(await response.arrayBuffer());
        textureUrl = `/api/assets/file/${encodeURIComponent(material.texture.filename)}`;
        textureFile = `textures/${material.texture.id}/${material.texture.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const runtimeFile: RuntimeFile = {
          path: textureFile,
          bytes,
          checksum: response.headers.get('etag') ?? `${material.texture.id}-${bytes.byteLength}`,
        };
        stageEditorFiles([runtimeFile]);
      }

      const nextXml = applyMaterialToNode(xml, node, {
        id: String(asset.id),
        name: asset.name,
        color: material.color,
        metallic: material.metallic,
        roughness: material.roughness,
        textureFile,
      });
      if (!nextXml) throw new Error('Could not apply this material to the selected object.');
      if (!applyCompiledXml(nextXml, sceneName, 'incremental')) {
        throw new Error('MuJoCo could not apply this material.');
      }

      pause();
      const materialName = materialNameFor({
        id: String(asset.id),
        name: asset.name,
        color: material.color,
        metallic: material.metallic,
        roughness: material.roughness,
        textureFile,
      });
      setTextureUrlsByMaterial((current) => {
        if (textureUrl) return { ...current, [materialName]: textureUrl };
        const remaining = { ...current };
        delete remaining[materialName];
        return remaining;
      });
      const geomIds = visualGeomIds(graph, node);
      setTextureUrlsByGeom((current) => {
        const next = { ...current };
        for (const geomId of geomIds) {
          if (textureUrl) next[geomId] = textureUrl;
          else delete next[geomId];
        }
        return next;
      });
      setTextureFaceByGeom((current) => {
        const next = { ...current };
        for (const geomId of geomIds) {
          if (textureUrl && face) next[geomId] = face;
          else delete next[geomId];
        }
        return next;
      });
      setTextureFaceStateReady(true);
      setRightPanel('inspector');
    },
    [applyCompiledXml, graph, pause, sceneName, selectedIds, stageEditorFiles, xml],
  );

  const addRobotToScene = useCallback(
    async (robot: RobotSummary, assertCurrent?: () => void) => {
      if (status !== 'ready') throw new Error('Wait for the MuJoCo runtime to finish loading.');
      if (!robot.mjcf || !robot.meshes.length) {
        throw new Error('This robot is missing its MJCF or source meshes.');
      }

      const sourceFiles = robotMeshSourceFiles(robot.mjcf);
      const meshFiles = new Map<string, string>();
      const mappedMeshes = sourceFiles.map((sourceFile) => {
        const matches = robot.meshes.filter(
          (mesh) =>
            mesh.sourceFilename === sourceFile ||
            (!mesh.sourceFilename && mesh.filename === sourceFile),
        );
        const mesh = matches[0];
        if (matches.length !== 1 || !mesh?.filename) {
          throw new Error(`Robot mesh "${sourceFile}" is not mapped to one source asset.`);
        }

        const filename = mesh.filename;
        const runtimePath = `assets/${mesh.id}/${sanitizedRuntimeFilename(filename)}`;
        meshFiles.set(sourceFile, runtimePath);
        return { sourceFile, mesh, filename, runtimePath };
      });
      const downloads = new Map<number, Promise<RuntimeFile>>();
      const downloaded = await Promise.all(
        mappedMeshes.map(async ({ sourceFile, mesh, filename, runtimePath }) => {
          let download = downloads.get(mesh.id);
          if (!download) {
            download = fetch(`/api/assets/file/${encodeURIComponent(filename)}`).then(
              async (response) => {
                if (!response.ok) throw new Error(`Could not download robot mesh "${sourceFile}".`);
                const bytes = new Uint8Array(await response.arrayBuffer());
                if (!bytes.byteLength) throw new Error(`Robot mesh "${sourceFile}" is empty.`);
                return {
                  path: runtimePath,
                  bytes,
                  checksum: response.headers.get('etag') ?? `${mesh.id}-${bytes.byteLength}`,
                };
              },
            );
            downloads.set(mesh.id, download);
          }
          return download;
        }),
      );
      const runtimeFiles = [
        ...new Map(downloaded.map((runtimeFile) => [runtimeFile.path, runtimeFile])).values(),
      ];

      assertCurrent?.();
      stageFiles(runtimeFiles);
      // Stand the robot on the first splat table when there is one, else at the origin.
      const [table] = simulationSplatTables(getSimulation());
      const position: readonly [number, number, number] = table
        ? [table.center[0], table.center[1], table.top]
        : [0, 0, 0];
      const placement: RobotPlacement = {
        robotId: String(robot.id),
        name: robot.name,
        mjcf: robot.mjcf,
        meshFiles,
        position,
        rotation: [1, 0, 0, 0],
      };
      const insertion = insertRobotModel(xml, placement);
      if (!insertion) throw new Error('Could not namespace this robot for the current scene.');
      if (!applyCompiledXml(insertion.xml, sceneName, 'incremental')) {
        throw new Error('MuJoCo rejected this robot in the current scene.');
      }

      pause();
      for (const runtimeFile of runtimeFiles) {
        stagedRuntimeFiles.current.set(runtimeFile.path, runtimeFile);
      }
      setGenerationRuntimeFiles([...stagedRuntimeFiles.current.values()]);
      setSaveError(null);
      pendingPlacedNode.current = { kind: 'body', name: insertion.bodyName };
      setRightPanel('inspector');
      setLeftPanel('scene');
    },
    [applyCompiledXml, getSimulation, pause, sceneName, stageFiles, status, xml],
  );

  useEffect(() => {
    const pending = pendingPlacedNode.current;
    if (!pending || !graph) return;
    const body = graph.order
      .map((id) => graph.nodes[id])
      .find((node) => node.kind === pending.kind && node.name === pending.name);
    if (!body) return;
    if (pending.edit) beginEdit(body.id);
    else select(body.id);
    if (pending.kind === 'camera') setPreviewCameraId(body.id);
    pendingPlacedNode.current = null;
  }, [beginEdit, graph, select]);

  const beginEditing = useCallback(
    (id?: string) => {
      const node = graph
        ? graph.nodes[id ?? (selectedIds.length === 1 ? selectedIds[0] : '')]
        : null;
      if (node?.kind === 'camera') setPreviewCameraId(null);
      beginEdit(id);
    },
    [beginEdit, graph, selectedIds],
  );

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save({ notify: true });
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
    if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      if (!previewCameraId) viewportRef.current?.focusSelection();
      return;
    }
    if (event.key === 'Escape' && generationPickStage) {
      cancelGenerationSelection();
      return;
    }
    // Scene editing (history, selection, transforms) belongs to Build only.
    if (workspaceMode !== 'build') return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      applyHistory(event.shiftKey ? redo() : undo());
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      applyHistory(redo());
      return;
    }
    if (event.key === 'Enter' && !editingId) beginEdit();
    if (event.key === 'Escape' && editingId) {
      if (editTool === 'place-on-object') setEditTool('transform');
      else endEdit();
      return;
    }
    if (event.key === 'w') setTransformMode('translate');
    if (event.key === 'e') setTransformMode('rotate');
    if (event.key === 'r' && (!editingNode || canScaleNode(graph, editingNode))) {
      setTransformMode('scale');
    }
    if (event.key === 'x' || event.key === 'y' || event.key === 'z') {
      toggleTransformAxis(event.key);
    }
    if (event.key === 's') toggleSnap();
    if (event.key === 'Delete' || event.key === 'Backspace') mutateSelected(deleteNode);
  });

  // Editing something that cannot scale while the Scale tool is active: fall back to Translate.
  useEffect(() => {
    if (transformMode === 'scale' && editingNode && !canScaleNode(graph, editingNode)) {
      setTransformMode('translate');
    }
  }, [editingNode, graph, setTransformMode, transformMode]);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const selectedNode = graph && selectedIds.length === 1 ? graph.nodes[selectedIds[0]] : null;
  const selectedParent = selectedNode?.parentId ? graph?.nodes[selectedNode.parentId] : null;
  const canMountCamera =
    (selectedNode?.kind === 'body' && selectedNode.mjIndex > 0) ||
    (selectedNode?.kind === 'site' &&
      selectedParent?.kind === 'body' &&
      selectedParent.mjIndex > 0);
  const selectedRobotPrefix = selectedNode ? robotInstancePrefixForNode(xml, selectedNode) : null;
  const canApplyMaterialToFace = isBoxSourceTarget(graph, selectedNode);
  // Recomputed on every compile (the graph changes with it): the tables and what is inside them.
  const splatTables = useMemo(
    () => (graph ? simulationSplatTables(getSimulation()) : []),
    [getSimulation, graph],
  );
  const tableOverlaps = useMemo(() => objectsInsideTables(splatTables), [splatTables]);
  // Splat tables are drawn only on the Build > Splat tab; leaving it also deselects them, so
  // nothing undrawn stays selected.
  const setSplatTablesVisible = useEditorStore((state) => state.setSplatTablesVisible);
  const splatTablesVisible = workspaceMode === 'build' && leftPanel === 'splat';
  useEffect(() => {
    setSplatTablesVisible(splatTablesVisible);
    if (splatTablesVisible || !graph) return;
    const { selectedIds: ids, setSelection } = useEditorStore.getState();
    const kept = ids.filter((id) => !graph.nodes[id] || !isSplatTableNode(graph.nodes[id]));
    if (kept.length !== ids.length) setSelection(kept);
  }, [graph, setSplatTablesVisible, splatTablesVisible]);

  const mcpBlockedReason =
    workspaceMode !== 'build'
      ? 'Switch to Build mode before agent editing.'
      : status !== 'ready'
        ? 'Wait for MuJoCo to be ready.'
        : sourceDirty
          ? 'Compile or discard the MJCF draft first.'
          : editingId
            ? 'Finish the active transform first.'
            : saving || archiveBusy
              ? 'Wait for the current save or import to finish.'
              : teleoperationStreaming || evaluationStreaming
                ? 'Stop external streaming before agent editing.'
                : null;
  const mcpGuardRef = useRef<string | null>(mcpBlockedReason);
  const mcpDocumentSnapshot = JSON.stringify({
    xml,
    sceneName,
    activeSceneId,
    homePose,
    splatCalibration,
  });
  const mcpDocumentRef = useRef(mcpDocumentSnapshot);
  useEffect(() => {
    mcpGuardRef.current = mcpBlockedReason;
    mcpDocumentRef.current = mcpDocumentSnapshot;
  }, [mcpBlockedReason, mcpDocumentSnapshot]);

  const handleMcpCommand = async (command: EditorCommand, assertConnected: () => void) => {
    const baseXml = useEditorStore.getState().xml;
    const baseDocument = JSON.stringify({
      xml: baseXml,
      sceneName,
      activeSceneId,
      homePose,
      splatCalibration,
    });
    const revision = await sha256Hex(new TextEncoder().encode(baseDocument));
    const assertCurrent = () => {
      assertConnected();
      if (useEditorStore.getState().xml !== baseXml || mcpDocumentRef.current !== baseDocument)
        throw new Error('The scene changed during this command. Read get_scene again.');
      if (mcpGuardRef.current) throw new Error(mcpGuardRef.current);
    };
    if (command.tool === 'get_scene') {
      assertConnected();
      const simulation = getSimulation();
      return {
        sceneId: activeSceneId,
        projectId,
        name: sceneName,
        revision,
        mjcf: baseXml,
        nodes: graph
          ? Object.values(graph.nodes).map((node) =>
              simulation && (node.kind === 'body' || node.kind === 'camera')
                ? { ...node, worldMatrix: matrixFromRuntime(simulation, node).toArray() }
                : node,
            )
          : [],
        dirty: documentDirty,
        blockedReason: mcpBlockedReason,
        coordinates: 'Z-up, meters, kilograms',
        angleUnit: compilerAngleUnit(baseXml),
      };
    }
    if (command.tool === 'render_camera') {
      assertConnected();
      const simulation = getSimulation();
      if (!simulation || !graph) throw new Error('No compiled scene is available to render.');
      const target = resolveRenderTarget(graph, command.input);
      const size = renderSize(
        target.kind === 'camera'
          ? simulation.cameraOutputSize(target.node.mjIndex)
          : FREE_VIEW_SIZE,
        command.input,
      );
      const id = crypto.randomUUID();
      const captured = await new Promise<CameraCaptureResult>((resolve) => {
        const timer = setTimeout(
          () =>
            resolve({
              error:
                'The camera render did not finish within 20 seconds. Keep the editor tab visible and try again.',
            }),
          20_000,
        );
        cameraCaptureWaiters.current.set(id, (result) => {
          clearTimeout(timer);
          resolve(result);
        });
        setCameraCapture({ id, view: target, ...size, hideSplat: command.input.hideSplat });
      });
      cameraCaptureWaiters.current.delete(id);
      setCameraCapture((current) => (current?.id === id ? null : current));
      if ('error' in captured) throw new Error(captured.error);
      const result: RenderCameraResult = {
        image: captured.dataUrl.slice(captured.dataUrl.indexOf(',') + 1),
        mimeType: 'image/png',
        ...size,
        camera: target.kind === 'camera' ? target.node.name : null,
        fovy: target.kind === 'camera' ? target.node.fovy : target.fovy,
        clipping: simulation.cameraClipping,
        splat: captured.splat,
      };
      return result;
    }
    if (command.tool === 'check_scene') {
      assertConnected();
      const simulation = getSimulation();
      if (!simulation) throw new Error('No compiled scene is available to check.');
      // Runs synchronously: the settle test steps and restores the live model between frames.
      return checkScene(simulation, command.input.settleSeconds);
    }
    if (command.tool === 'detect_table') {
      assertConnected();
      const simulation = getSimulation();
      if (!simulation) throw new Error('No compiled scene is available.');
      return detectTables(simulation, command.input);
    }
    if (command.tool === 'list_robots') {
      const result = await listRobots(command.input);
      return {
        ...result,
        docs: result.docs.map(({ id, name, description, manufacturer }) => ({
          id,
          name,
          description,
          manufacturer,
        })),
      };
    }
    if (command.tool === 'list_assets') {
      const result = await queryAssets({
        ...command.input,
        kind: 'mesh',
        robotMeshes: await listRobotMeshReferences(),
      });
      return { ...result, docs: result.docs.map(mcpAssetSummary) };
    }
    assertCurrent();
    if (command.input.expectedRevision !== revision) {
      throw new Error(
        'Stale scene revision. Call get_scene and plan against the current document.',
      );
    }
    pause();
    if (command.tool === 'apply_scene_operations' || command.tool === 'add_table') {
      if (!graph) throw new Error('No compiled scene graph is available.');
      const operations =
        command.tool === 'add_table'
          ? [{ ...command.input, type: 'add_table' as const }]
          : command.input.operations;
      const candidate = applySceneOperations(baseXml, graph, operations);
      assertCurrent();
      if (!applyCompiledXml(candidate, sceneName, 'incremental')) {
        throw new Error(
          getLastLoadError() ?? 'MuJoCo rejected the candidate scene. No edits were committed.',
        );
      }
      return {
        compiled: true,
        saved: false,
        message:
          'Scene updated. Call get_scene to inspect new names and revision before the next edit or save.',
      };
    }
    if (command.tool === 'add_scan_table') {
      const { center, size, top, yaw } = command.input;
      const inserted = insertSplatTable(
        baseXml,
        [center[0], center[1], top],
        [size[0] / 2, size[1] / 2, SPLAT_TABLE_HALF_SIZE[2]],
        (yaw * Math.PI) / 180,
      );
      if (!inserted) throw new Error('Invalid scan table: give a finite centre, top, and size.');
      assertCurrent();
      if (!applyCompiledXml(inserted.xml, sceneName, 'incremental')) {
        throw new Error(getLastLoadError() ?? 'MuJoCo rejected the table. No edits were made.');
      }
      return {
        compiled: true,
        saved: false,
        name: inserted.name,
        message: `Added ${inserted.name}. Call get_scene for the new revision, then place_object to set objects on it.`,
      };
    }
    if (command.tool === 'place_object') {
      const simulation = getSimulation();
      if (!simulation || !graph) throw new Error('No compiled scene graph is available.');
      const { at, on, beside, offset, object, yaw } = command.input;
      if ([at, on, beside].filter((value) => value !== undefined).length !== 1) {
        throw new Error('Give exactly one of at, on, or beside.');
      }
      const target: PlacementTarget = at
        ? { kind: 'at', x: at[0], y: at[1] }
        : on
          ? { kind: 'on', surface: on, offset }
          : {
              kind: 'beside',
              reference: beside!.object,
              direction: beside!.direction,
              gap: beside!.gap,
            };
      const plan = planPlacement(simulation, object, target, yaw);
      const candidate = applySceneOperations(baseXml, graph, [
        {
          type: 'set_attribute',
          target: { kind: 'body', name: object },
          attribute: 'pos',
          value: plan.position,
        },
        {
          type: 'set_attribute',
          target: { kind: 'body', name: object },
          attribute: 'quat',
          value: plan.quat,
        },
      ]);
      assertCurrent();
      if (!applyCompiledXml(candidate, sceneName, 'incremental')) {
        throw new Error(getLastLoadError() ?? 'MuJoCo rejected the placement. No edits were made.');
      }
      return {
        compiled: true,
        saved: false,
        object,
        position: plan.position,
        quat: plan.quat,
        restsOn: plan.support,
        supportTop: plan.supportTop,
        message: `Placed on ${plan.support}. Call get_scene for the new revision; check_scene confirms it rests.`,
      };
    }
    if (command.tool === 'set_object_physics') {
      const simulation = getSimulation();
      if (!simulation) throw new Error('No compiled scene is available.');
      const { object, largestDimension, scale, mass, friction } = command.input;
      if (largestDimension !== undefined && scale !== undefined) {
        throw new Error('Give largestDimension or scale, not both.');
      }
      if ([largestDimension, scale, mass, friction].every((value) => value === undefined)) {
        throw new Error('Give at least one of largestDimension, scale, mass, or friction.');
      }
      let candidate: string | null = baseXml;
      const before = bodyDimensions(simulation, object);
      const factor =
        largestDimension !== undefined ? largestDimension / Math.max(...before) : scale;
      if (factor !== undefined && Math.abs(factor - 1) > 1e-9) {
        // Scaling happens about the body origin; raise it so its bottom stays on its support.
        const bottom = currentWorldBounds(simulation, object).low[2];
        const origin = simulation.bodyPositions[simulation.bodyIndex(object) * 3 + 2];
        candidate = scaleObject(candidate, object, factor, (bottom - origin) * (1 - factor));
      }
      if (candidate && mass !== undefined) candidate = setObjectMass(candidate, object, mass);
      if (candidate && friction !== undefined) {
        candidate = setObjectFriction(
          candidate,
          object,
          typeof friction === 'number' ? [friction] : friction,
        );
      }
      if (!candidate) {
        throw new Error(`Could not update "${object}": it must be a top-level body with geometry.`);
      }
      assertCurrent();
      if (!applyCompiledXml(candidate, sceneName, 'incremental')) {
        throw new Error(getLastLoadError() ?? 'MuJoCo rejected the change. No edits were made.');
      }
      const updated = getSimulation();
      const index = updated?.bodyIndex(object) ?? -1;
      return {
        compiled: true,
        saved: false,
        object,
        dimensions: updated ? bodyDimensions(updated, object) : null,
        mass: updated && index > 0 ? (updated.model.body_subtreemass as Float64Array)[index] : null,
        scaledBy: factor ?? 1,
        message: 'Updated. Call get_scene for the new revision.',
      };
    }
    if (command.tool === 'add_robot') {
      const robot = await getRobot(command.input.robotId);
      assertCurrent();
      await addRobotToScene(robot, assertCurrent);
      return {
        compiled: true,
        saved: false,
        message: 'Robot added. Call get_scene to inspect its names and position.',
      };
    }
    if (command.tool === 'add_asset') {
      const asset = await getAsset(command.input.assetId);
      if (asset.kind !== 'mesh') throw new Error('Only objects from list_assets can be added.');
      if (!mcpAssetSummary(asset).placeable) {
        throw new Error(
          `Object "${asset.name}" is ${asset.processingStatus}, not ready. Try again once it is ready.`,
        );
      }
      assertCurrent();
      const { position } = command.input;
      const placement = !position
        ? undefined
        : asset.primitive
          ? { ...asset.primitive, name: asset.name, position, rotation: [0, 0, 0] as const }
          : { position, rotation: [1, 0, 0, 0] as const };
      await addAssetToScene(asset, placement, assertCurrent);
      return {
        compiled: true,
        saved: false,
        message: 'Object added. Call get_scene to inspect its names and position.',
      };
    }
    if (!projectId || !sceneName.trim() || currentHomePoseError) {
      throw new Error(currentHomePoseError ?? 'A project and scene name are required to save.');
    }
    const saved = await save({ notify: true });
    if (!saved)
      throw new Error(
        'Scene was not saved. Check the editor save notice and resolve the problem before retrying.',
      );
    return { sceneId: saved.id, saved: true, updatedAt: saved.updatedAt };
  };

  return (
    <div className="flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden">
      <CompactToolbar
        mcpControls={
          <McpPanel
            key={activeSceneId ?? 'new'}
            onCommand={handleMcpCommand}
            unavailableReason={
              !activeSceneId
                ? 'Save this new scene once before enabling MCP. The agent can then build and save its contents.'
                : undefined
            }
          />
        }
        onBackToScenes={projectId ? () => router.push(`/projects/${projectId}`) : undefined}
        workspaceMode={workspaceMode}
        onWorkspaceModeChange={(mode) => changeWorkspaceMode(mode)}
        activeSceneName={sceneName}
        onSceneNameChange={setSceneName}
        onSave={() => void save({ notify: true })}
        onSaveAsTemplate={openTemplateDialog}
        onExport={() => void exportArchive()}
        onImport={() => {
          enterBuild();
          archiveInput.current?.click();
        }}
        onExportXml={exportXml}
        onImportXml={() => {
          enterBuild();
          xmlInput.current?.click();
        }}
        onAddCamera={() => {
          enterBuild();
          addCamera();
        }}
        onMountCamera={() => {
          enterBuild();
          mountCamera();
        }}
        onAddLight={() => {
          enterBuild();
          addLight();
        }}
        canMountCamera={canMountCamera}
        canSimulate={!editingId}
        canSave={Boolean(projectId) && !sourceDirty}
        canSaveAsTemplate={Boolean(projectId) && !sourceDirty && !currentHomePoseError}
        saving={saving}
        archiveBusy={archiveBusy}
        documentDirty={documentDirty}
        canExportXml={!sourceDirty}
        saveError={sourceDirty ? 'Compile the MJCF draft before saving.' : saveError}
        onUndo={() => applyHistory(undo())}
        onRedo={() => applyHistory(redo())}
        canDuplicate={Boolean(selectedIds.length && !selectedRobotPrefix)}
        onDuplicate={() => {
          enterBuild();
          mutateSelected(duplicateNode);
        }}
        canDelete={Boolean(selectedIds.length)}
        onDelete={() => {
          enterBuild();
          mutateSelected(deleteNode);
        }}
      />

      <Dialog
        open={buildSwitchWarning}
        title={teleoperationRecording ? 'Generate is recording' : 'Generate is streaming'}
        description={
          teleoperationRecording
            ? 'The recording keeps running on the saved scene and stays in the current Generate version. Scene edits apply to new recordings after you save them.'
            : 'Streaming keeps running on the saved scene while you edit. When you save model changes, Generate starts a new version, and streaming restarts with the edited scene when you return to Generate. Nothing recorded so far is lost.'
        }
        onClose={() => setBuildSwitchWarning(false)}
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setBuildSwitchWarning(false)}>
            Stay in Generate
          </Button>
          {!teleoperationRecording && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setBuildSwitchWarning(false);
                stopTeleoperationStream()
                  .then(() => restoreTeleoperationState(true))
                  .catch(() => undefined);
                changeWorkspaceMode('build', { confirmed: true });
              }}
            >
              Stop streaming and edit
            </Button>
          )}
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              setBuildSwitchWarning(false);
              changeWorkspaceMode('build', { confirmed: true });
            }}
          >
            {teleoperationRecording ? 'Edit anyway' : 'Keep streaming and edit'}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={templateDialogOpen}
        title="Save as template"
        description="Create a reusable copy of the current compiled scene. Your current scene stays open."
        onClose={() => {
          if (!saving) setTemplateDialogOpen(false);
        }}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            saveAsTemplate();
          }}
        >
          {templateError && <p className="text-xs text-danger">{templateError}</p>}
          <label className="block text-xs text-muted">
            Template name
            <input
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              className="mt-1.5 h-9 w-full border border-border bg-surface-raised px-3 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/50"
              autoFocus
              disabled={saving}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setTemplateDialogOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? <LoaderCircle className="animate-spin" /> : <Copy />}
              {saving ? 'Saving' : 'Save template'}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={pendingPackageImport !== null}
        title="Choose the model to import"
        description="This ZIP contains several MuJoCo models. Pick the main one; files it includes are merged in."
        onClose={() => {
          if (!archiveBusy) setPendingPackageImport(null);
        }}
      >
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {pendingPackageImport?.candidates.map((candidate) => (
            <Button
              key={candidate}
              type="button"
              variant="ghost"
              className="justify-start font-mono text-xs"
              disabled={archiveBusy}
              onClick={() => {
                const pending = pendingPackageImport;
                setPendingPackageImport(null);
                importPackage(pending.file, candidate);
              }}
            >
              <FileCode2 />
              {candidate}
            </Button>
          ))}
        </div>
      </Dialog>

      <input
        ref={archiveInput}
        type="file"
        accept=".zip,.mujoco-scene,application/zip"
        aria-label="Import scene ZIP"
        className="hidden"
        onChange={(event) => void importArchive(event)}
      />
      <input
        ref={xmlInput}
        type="file"
        accept=".xml,text/xml,application/xml"
        aria-label="Import MJCF XML"
        className="hidden"
        onChange={(event) => void importXml(event)}
      />

      <div className="flex min-h-0 flex-1">
        <div
          className={cn('hidden min-h-0 shrink-0 flex-col', workspaceMode === 'build' && 'lg:flex')}
        >
          <div className="flex h-9 w-72 shrink-0 border-b border-r border-border bg-surface px-1">
            <Button
              size="sm"
              variant={leftPanel === 'scene' ? 'ghost' : 'outline'}
              className="h-8 flex-1 rounded-none border-0"
              onClick={() => setLeftPanel('scene')}
            >
              Scene
            </Button>
            <Button
              size="sm"
              variant={leftPanel === 'assets' ? 'ghost' : 'outline'}
              className="h-8 flex-1 rounded-none border-0"
              onClick={() => setLeftPanel('assets')}
            >
              Assets
            </Button>
            <Button
              size="sm"
              variant={leftPanel === 'robots' ? 'ghost' : 'outline'}
              className="h-8 flex-1 rounded-none border-0"
              onClick={() => setLeftPanel('robots')}
            >
              Robots
            </Button>
            <Button
              size="sm"
              variant={leftPanel === 'splat' ? 'ghost' : 'outline'}
              className="h-8 flex-1 rounded-none border-0"
              onClick={() => setLeftPanel('splat')}
            >
              Splat
            </Button>
          </div>
          {leftPanel === 'scene' ? (
            <SceneTree onDocumentChange={applyDocument} />
          ) : leftPanel === 'robots' ? (
            <RobotBrowserPanel onAddToScene={addRobotToScene} />
          ) : leftPanel === 'splat' ? (
            <SplatBrowserPanel
              onFileSelected={handleSplatFileSelected}
              onClear={handleClearSplat}
              onCalibrationChange={handleSplatCalibrationChange}
              onAutoLevel={handleSplatAutoLevel}
              orientationNote={splatOrientationNote}
              tables={splatTables}
              overlaps={tableOverlaps}
              tableNote={tableNote}
              onAddTable={addSplatTable}
              onMatchTableHeight={matchTableHeight}
              onDropOntoTable={dropOntoTable}
              onSelectTable={(name) => {
                const node = graph
                  ? Object.values(graph.nodes).find(
                      (candidate) => isSplatTableNode(candidate) && candidate.name === name,
                    )
                  : null;
                if (node) beginEditing(node.id);
              }}
            />
          ) : (
            <AssetBrowserPanel
              previewAssetId={previewAsset?.id ?? null}
              onPreviewAsset={(asset) =>
                setPreviewAsset((current) => (current?.id === asset.id ? null : asset))
              }
              onAddToScene={addAssetToScene}
              onAddObjectModel={addObjectModelToScene}
              onDragAsset={setDraggedAsset}
              canApplyMaterialToFace={canApplyMaterialToFace}
              hasSceneSelection={Boolean(
                graph &&
                selectedIds.length === 1 &&
                (graph.nodes[selectedIds[0]]?.kind === 'body' ||
                  graph.nodes[selectedIds[0]]?.kind === 'geom'),
              )}
              onApplyMaterial={applyMaterial}
            />
          )}
        </div>

        <main className="relative min-w-0 flex-1">
          <ViewportErrorBoundary
            fallback={(message) => (
              <div className="flex h-full items-center justify-center px-8 text-center text-xs text-muted">
                3D viewport unavailable — {message}
              </div>
            )}
          >
            <Viewport
              ref={viewportRef}
              onTransformCommit={onTransformCommit}
              draggedAsset={
                draggedAsset
                  ? {
                      id: draggedAsset.id,
                      name: draggedAsset.name,
                      dimensions: dimensionsForAsset(draggedAsset),
                    }
                  : null
              }
              onAssetDrop={handleAssetDrop}
              textureUrlsByMaterial={textureUrlsByMaterial}
              textureUrlsByGeom={textureUrlsByGeom}
              textureFaceByGeom={textureFaceByGeom}
              cameraPoseRef={cameraPoseRef}
              onBeginEdit={beginEditing}
              generationPickStage={generationPickStage}
              generationSourceBody={generationSourceBody}
              generationPickMessage={generationPickMessage}
              onGenerationBodySelect={selectGenerationBody}
              onCancelGenerationPick={cancelGenerationSelection}
              generationZone={generationZone}
              splatSrc={splatSrc}
              splatOrigin={splatOrigin}
              splatScale={splatCalibration.scale}
              splatRotation={splatRotation}
              onSplatStatusChange={handleSplatStatusChange}
              onSplatLoad={handleSplatLoad}
              onSplatError={handleSplatError}
            />
          </ViewportErrorBoundary>

          {workspaceMode === 'build' && <ViewportToolStrip onBeginEdit={beginEditing} />}
          {workspaceMode === 'build' && (
            <BuildGenerateNotice
              sceneId={activeSceneId ?? undefined}
              documentDirty={documentDirty}
              xml={xml}
              savedXml={savedXml}
            />
          )}

          {status !== 'ready' && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted">
              {status === 'error' ? (error ?? 'Failed to start MuJoCo') : 'Loading MuJoCo WASM…'}
            </div>
          )}
          {previewAsset && (
            <AssetPreview asset={previewAsset} onClose={() => setPreviewAsset(null)} />
          )}
          {workspaceMode === 'generate' && (
            <div ref={setEpisodeStatsHost} className="absolute left-3 top-3 z-20" />
          )}
          {workspaceMode === 'generate' && (
            <div ref={setEpisodeCameraHost} className="absolute bottom-3 left-3 z-20" />
          )}
          {previewCameraId && (
            <CameraPreviewWindow
              cameraId={previewCameraId}
              onClose={() => setPreviewCameraId(null)}
              textureUrlsByMaterial={textureUrlsByMaterial}
              textureUrlsByGeom={textureUrlsByGeom}
              textureFaceByGeom={textureFaceByGeom}
              splatSrc={splatSrc}
              splatOrigin={splatOrigin}
              splatScale={splatCalibration.scale}
              splatRotation={splatRotation}
            />
          )}
          {cameraCapture && (
            <CameraCapture
              request={cameraCapture}
              onDone={(id, result) => cameraCaptureWaiters.current.get(id)?.(result)}
              textureUrlsByMaterial={textureUrlsByMaterial}
              textureUrlsByGeom={textureUrlsByGeom}
              textureFaceByGeom={textureFaceByGeom}
              splatSrc={splatSrc}
              splatOrigin={splatOrigin}
              splatScale={splatCalibration.scale}
              splatRotation={splatRotation}
            />
          )}
        </main>

        <aside className="hidden w-[22rem] shrink-0 flex-col border-l border-border bg-surface lg:flex">
          {workspaceMode === 'simulate' ? (
            <EvaluationPanel
              sceneId={activeSceneId ?? undefined}
              sceneName={sceneName}
              sceneXml={xml}
              runtimeFiles={workerRuntimeFiles}
              homePoseError={currentHomePoseError ?? homePoseStatus}
              onHomePoseClear={clearHomePose}
            />
          ) : workspaceMode === 'generate' ? (
            <GenerationPanel
              sceneId={activeSceneId ?? undefined}
              sceneName={sceneName}
              sceneXml={xml}
              runtimeFiles={workerRuntimeFiles}
              ready={status === 'ready'}
              documentDirty={documentDirty}
              episodeCameraHost={episodeCameraHost}
              episodeStatsHost={episodeStatsHost}
              homePoseError={currentHomePoseError}
              selectedSourceBody={generationSourceBody}
              generationPickStage={generationPickStage}
              onSourceBodyChange={(body) => {
                setGenerationSourceBody(body);
                setGenerationPickMessage(null);
              }}
              onBeginViewportSelection={beginGenerationSelection}
              onCancelViewportSelection={cancelGenerationSelection}
            />
          ) : (
            <>
              <div className="flex h-9 shrink-0 border-b border-border px-1">
                <Button
                  size="sm"
                  variant={rightPanel === 'inspector' ? 'ghost' : 'outline'}
                  className="h-8 flex-1 rounded-none border-0"
                  onClick={() => setRightPanel('inspector')}
                >
                  Inspector
                </Button>
                <Button
                  size="sm"
                  variant={rightPanel === 'mjcf' ? 'ghost' : 'outline'}
                  className="h-8 flex-1 rounded-none border-0"
                  onClick={() => setRightPanel('mjcf')}
                >
                  MJCF
                </Button>
                <Button
                  size="sm"
                  variant={rightPanel === 'revisions' ? 'ghost' : 'outline'}
                  className="h-8 flex-1 rounded-none border-0"
                  onClick={() => setRightPanel('revisions')}
                >
                  Revisions
                </Button>
              </div>
              {rightPanel === 'inspector' ? (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <TransformSettings />
                  <ViewportSettings />
                  <InspectorPanel
                    showHeader={false}
                    tableOverlaps={tableOverlaps}
                    onDropOntoTable={(name) => dropOntoTable([name])}
                    onDocumentChange={applyDocument}
                    onBackdropRotation={handleBackdropInspectorRotation}
                    onPreviewCamera={previewCamera}
                    previewCameraId={previewCameraId}
                  />
                </div>
              ) : rightPanel === 'mjcf' ? (
                <MjcfPanel
                  source={sourceDirty ? source : formattedXml}
                  dirty={sourceDirty}
                  selectedNode={selectedNode}
                  onChange={(value) => {
                    setSource(value);
                  }}
                  onCompile={() => applyBackdropPose(source)}
                />
              ) : (
                <RevisionPanel
                  projectId={projectId}
                  sceneId={activeSceneId}
                  refreshKey={revisionRefreshKey}
                  onRestore={restoreRevision}
                />
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
