// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  EvaluationValidationError,
  type EvaluationActionFieldV1,
  type EvaluationCameraOutputV1,
  type EvaluationInputConventionV1,
  type EvaluationRange,
  type EvaluationStateFieldV1,
  type EvaluationValidationIssue,
  type EvaluationValidationResult,
  type ModelRandomizationRuleV1,
  validateModelRandomizationRule,
} from './evaluation';
import { isSplatPath } from './splat';

export * from './splat';

export const TELEOPERATION_PROTOCOL_VERSION = 1 as const;
export const TELEOPERATION_DEFAULT_STREAM_HZ = 30;
export const TELEOPERATION_MIN_STREAM_HZ = 1;
export const TELEOPERATION_MAX_STREAM_HZ = 120;
export const TELEOPERATION_MAX_PHYSICS_STEPS = 1_000;
/** Dataset frames (controller commands) per simulated second, like LeRobot recordings. */
export const TELEOPERATION_DEFAULT_CAPTURE_FPS = 30;
export const TELEOPERATION_MIN_CAPTURE_FPS = 1;
export const TELEOPERATION_MAX_CAPTURE_FPS = 120;

export type TeleoperationProtocolVersion = typeof TELEOPERATION_PROTOCOL_VERSION;
export type TeleoperationSessionStatus =
  'starting' | 'ready' | 'active' | 'stopping' | 'stopped' | 'failed';
export type TeleoperationRecordingStatus = 'idle' | 'recording' | 'stopping';
export type TeleoperationEpisodeStatus = 'recorded' | 'discarded' | 'interrupted';
export type TeleoperationStateId = string;

export interface TeleoperationSourceRandomizationV1 {
  enabled: boolean;
  body: string;
  xCm: EvaluationRange;
  yCm: EvaluationRange;
  yawDegrees: EvaluationRange;
  /**
   * Extra free bodies placed after the main body, each offset from its authored pose. Draws that
   * overlap an already-placed body are retried, so several objects can share one region.
   */
  objects?: TeleoperationRandomizedObjectV1[];
}

/** One extra randomized body; ranges are offsets from the body's authored pose. */
export interface TeleoperationRandomizedObjectV1 {
  body: string;
  xCm: EvaluationRange;
  yCm: EvaluationRange;
  yawDegrees: EvaluationRange;
}

/**
 * Robot start-pose randomization for generated states: every listed joint (default: every arm
 * hinge joint except the gripper) is offset from the authored pose by a uniform draw in degrees.
 */
export interface TeleoperationRobotRandomizationV1 {
  enabled: boolean;
  degrees: EvaluationRange;
  joints?: string[];
}

/**
 * Gaussian-splat backdrop rendered behind the MuJoCo scene. The pose source of truth is the static
 * MJCF body `body` (default `rs_backdrop`): splat points in that body's frame are
 * `q = scale * R(rotation) * p_raw`, where `p_raw` are the raw PLY coordinates (no axis flip), so
 * the splat render matrix is `bodyWorld * R * S(scale)`.
 */
/**
 * What the backdrop leaves out of a splat scan, in the backdrop body frame (`scale * R * p_raw`);
 * the rule is in apps/web/lib/editor/splatCleanup.ts and robotic_studio/generation/backdrop.py.
 */
export interface SplatCleanupV1 {
  /** Keep only Gaussians whose centre lies in this box (meters). */
  crop?: { min: [number, number, number]; max: [number, number, number] };
  /** Drop Gaussians fainter than this (0-1). */
  minOpacity?: number;
  /** Drop visible Gaussians with fewer than `minNeighbors` others in their voxel and the 26 around it. */
  isolation?: { cell: number; minNeighbors: number };
}

export interface TeleoperationBackdropV1 {
  /** Bundle-relative path of the splat PLY or SPZ (for example `splats/12/scene.ply`). */
  asset: string;
  backend?: 'intel-xpu';
  /** Static MJCF body carrying the backdrop pose and collision heightfield. */
  body?: string;
  /** Uniform calibration scale applied to raw PLY coordinates; positive. */
  scale?: number;
  /**
   * Calibration rotation from raw PLY coordinates to the backdrop body frame, as a unit quaternion
   * `[w, x, y, z]` (MuJoCo order) applied before `scale`. Default identity.
   */
  rotation?: [number, number, number, number];
  /** SHA-256 hex digest of the PLY bytes. */
  hash?: string;
  /** Parts of the scan left out, as in the editor (absent: the whole scan). */
  cleanup?: SplatCleanupV1;
}

export interface TeleoperationProfileV1 {
  version: TeleoperationProtocolVersion;
  name: string;
  inputConvention: EvaluationInputConventionV1;
  sceneId: string;
  sceneFingerprint: string;
  state: EvaluationStateFieldV1[];
  action: EvaluationActionFieldV1[];
  cameras: EvaluationCameraOutputV1[];
  physicsSteps: number;
  streamHz: number;
  captureRgb: boolean;
  /** Recorded frames per simulated second; clients send one command per frame. Default 30. */
  captureFps?: number;
  sourceRandomization?: TeleoperationSourceRandomizationV1;
  /** Appearance and physics rules sampled for every new randomized state. */
  modelRandomization?: ModelRandomizationRuleV1[];
  robotRandomization?: TeleoperationRobotRandomizationV1;
  backdrop?: TeleoperationBackdropV1;
  /** Optional conservative live-teleoperation budget for expensive splat rendering. */
  backdropRenderBudget?: { enabled?: boolean; maxFrameTimeMs: number };
}

/** One MjModel field write, recorded so a state or episode can be restored exactly. */
export interface TeleoperationModelOverrideV1 {
  field: string;
  index: number;
  values: number[];
}

export interface TeleoperationRandomizationSampleV1 {
  target: string;
  values: number[];
  selected?: string;
  /** Rule kind and position; present on model randomization samples. */
  kind?: string;
  ruleIndex?: number;
  /** Joint names matching `values`; present on robot start-pose samples. */
  names?: string[];
  /** The rule a model sample was drawn from, kept so the state can be rebuilt in an edited scene. */
  rule?: ModelRandomizationRuleV1;
}

/** Where a generated state carried over from an earlier scene version was rebuilt from. */
export interface TeleoperationStateOriginV1 {
  collectionId: string;
  stateId: TeleoperationStateId;
  label: string;
}

export interface TeleoperationStateSnapshotV1 {
  stateId: TeleoperationStateId;
  label: string;
  index: number;
  seed: number;
  createdAt: string;
  sourceRandomization?: TeleoperationRandomizationSampleV1;
  /** Extra object poses (`values` = x cm, y cm, yaw degrees) already applied to qpos. */
  objectRandomization?: TeleoperationRandomizationSampleV1[];
  modelRandomization?: TeleoperationRandomizationSampleV1[];
  modelOverrides?: TeleoperationModelOverrideV1[];
  /** Robot joint offsets in degrees already applied to qpos and ctrl. */
  robotRandomization?: TeleoperationRandomizationSampleV1;
  /** Present on states carried over from an earlier scene version. */
  origin?: TeleoperationStateOriginV1;
  qpos: number[];
  qvel: number[];
  ctrl: number[];
}

export interface TeleoperationPendingRecordingV1 {
  episodeId: string;
  stateId: TeleoperationStateId;
  frameCount: number;
  startedAt: string;
  stoppedAt: string;
  simulationStartTime: number;
  simulationEndTime: number;
}

export interface TeleoperationEpisodeSummaryV1 {
  episodeId: string;
  episodeIndex: number;
  stateId: TeleoperationStateId;
  status: TeleoperationEpisodeStatus;
  frameCount: number;
  startedAt: string;
  endedAt?: string;
  simulationStartTime: number;
  simulationEndTime?: number;
  artifactPath?: string;
  name?: string;
  notes?: string;
  task?: string;
  /** Collection-wide recording counter; discarded recordings also consume an index. */
  recordingIndex?: number;
  /** Seed a scripted controller uses to vary this attempt. */
  attemptSeed?: number;
  /** Small JSON the recording client saved with the episode, such as sampled variation. */
  controller?: Record<string, unknown>;
}

export interface TeleoperationEpisodeImageV1 {
  name: string;
  width: number;
  height: number;
}

/** A recorded camera, stored as one episode video; frame i plays at i / fps. */
export interface TeleoperationEpisodeCameraV1 extends TeleoperationEpisodeImageV1 {
  video: { fps: number; frameCount: number };
}

export interface TeleoperationEpisodeFrameV1 {
  frameIndex: number;
  timestamp: number;
  qpos?: number[];
  qvel?: number[];
  ctrl?: number[];
  state: number[];
  action: number[];
  task: string;
  phase?: string | null;
  selectedObject?: string | null;
  randomization: TeleoperationRandomizationSampleV1[];
  metadata: Record<string, unknown>;
  images: TeleoperationEpisodeImageV1[];
}

export interface TeleoperationEpisodeReviewV1 {
  episode: TeleoperationEpisodeSummaryV1;
  frames: TeleoperationEpisodeFrameV1[];
  cameras: TeleoperationEpisodeCameraV1[];
}

/**
 * Generated scenes rebuilt in a new scene version from an earlier one. Written once, when the new
 * version's Generate data is first opened.
 */
export interface TeleoperationCarryOverV1 {
  fromCollectionId: string;
  /** When the earlier version was last changed, for display. */
  fromUpdatedAt: string;
  carriedAt: string;
  imported: { fromStateId: TeleoperationStateId; stateId: TeleoperationStateId }[];
  skipped: { stateId: TeleoperationStateId; label: string; reason: string }[];
  /** Set when the rebuild itself failed; the new version then starts empty. */
  error?: string;
}

/**
 * One version of a saved scene's Generate data: generated scenes and recorded episodes collected
 * for one scene content (fingerprint) and capture profile. Editing and saving the scene starts a
 * new version; earlier versions stay on disk and can be reviewed, downloaded, or deleted.
 */
export interface TeleoperationSceneVersionV1 {
  collectionId: string;
  sceneId: string;
  sceneFingerprint: string;
  /** Scene name when the version was last opened. */
  name: string | null;
  createdAt: string;
  updatedAt: string;
  /** Generated scenes, excluding the authored base state. */
  generatedCount: number;
  /** Recorded episodes with frames. */
  episodeCount: number;
  /** True for the version the open Generate session uses. */
  current: boolean;
  /** Whether the version's episodes can be merged into the current version's dataset download. */
  mergeable: boolean;
  /** Why `mergeable` is false (null when it is true or there is no current version). */
  mergeIssue: string | null;
  carryOver: TeleoperationCarryOverV1 | null;
}

/** A read-only view of a scene version's generated scenes and episodes. */
export interface TeleoperationSceneVersionDetailV1 {
  version: TeleoperationSceneVersionV1;
  states: TeleoperationStateSnapshotV1[];
  episodes: TeleoperationEpisodeSummaryV1[];
  streamHz: number;
}

export interface TeleoperationCollectionSummaryV1 {
  collectionId: string;
  sceneId: string;
  sceneFingerprint: string;
  createdAt: string;
  updatedAt: string;
  nextStateIndex: number;
  nextEpisodeIndex: number;
  states: TeleoperationStateSnapshotV1[];
  episodes: TeleoperationEpisodeSummaryV1[];
}

export interface TeleoperationEndpointsV1 {
  control: string;
  publisher: string;
  stream: string;
}

export interface TeleoperationSessionSummaryV1 {
  protocolVersion: TeleoperationProtocolVersion;
  sessionId: string;
  collectionId: string;
  sceneId: string;
  sceneFingerprint: string;
  status: TeleoperationSessionStatus;
  endpoints: TeleoperationEndpointsV1;
  profile: TeleoperationProfileV1;
  activeStateId: TeleoperationStateId;
  stateRevision: number;
  recording: TeleoperationRecordingStatus;
  pendingRecording: TeleoperationPendingRecordingV1 | null;
  activeEpisodeId?: string;
  episodeCount: number;
  streamHz: number;
  streamSequence: number;
  episodes: TeleoperationEpisodeSummaryV1[];
  batch?: TeleoperationBatchStatusV1;
  pid: number | null;
  error?: string;
}

export type TeleoperationCommandKindV1 =
  | 'hello'
  | 'describe'
  | 'acquire'
  | 'step'
  | 'reset'
  | 'release'
  | 'ping'
  | 'record.start'
  | 'record.stop'
  | 'record.save'
  | 'record.discard'
  | 'episode.update'
  | 'episode.delete'
  | 'state.append'
  | 'states.import'
  | 'state.select'
  | 'state.delete'
  | 'batch.start'
  | 'batch.status'
  | 'batch.cancel'
  | 'session.shutdown';

export interface TeleoperationBatchStatusV1 {
  jobId: string;
  status: 'idle' | 'running' | 'completed' | 'cancelled' | 'failed';
  /** Planned attempts. */
  total: number;
  /** Attempts with a final outcome (recorded, failed, or worker-crashed). */
  resolved: number;
  /** Resolved attempts that recorded an episode. */
  saved: number;
  /** Episodes committed to the collection so far (in plan order; a cancel keeps the prefix). */
  committed: number;
  /** Resolved attempts without an episode (`resolved - saved`). */
  failed: number;
  failuresByReason: Record<string, number>;
  /** Recorded frames, including attempts still running. */
  recordedFrames: number;
  framesPerSecond: number;
  etaSeconds: number | null;
  workerCount: number;
  /** Worker process crashes; the job fails on the third. */
  crashes: number;
  /** CPU count of the worker host (upper bound for `workers`). */
  cpuCount: number;
  cancelRequested: boolean;
  /** Why the job failed (status `failed`). */
  error?: string;
}

export interface TeleoperationCommandBaseV1 {
  protocolVersion: TeleoperationProtocolVersion;
  sessionId: string;
  clientId: string;
  requestId: number;
  command: TeleoperationCommandKindV1;
  leaseId?: string;
  expectedStateRevision?: number;
}

export interface TeleoperationHelloCommandV1 extends TeleoperationCommandBaseV1 {
  command: 'hello';
  supportedVersions: TeleoperationProtocolVersion[];
}

export interface TeleoperationDescribeCommandV1 extends TeleoperationCommandBaseV1 {
  command: 'describe';
}

export interface TeleoperationAcquireCommandV1 extends TeleoperationCommandBaseV1 {
  command: 'acquire';
  sceneFingerprint: string;
}

export interface TeleoperationBodyPoseV1 {
  position: number[];
  quaternion?: number[];
}

export interface TeleoperationKinematicStateV1 {
  jointPositions?: Record<string, number>;
  bodyPoses?: Record<string, TeleoperationBodyPoseV1>;
}

export interface TeleoperationStepCommandV1 extends TeleoperationCommandBaseV1 {
  command: 'step';
  targets: Record<string, number>;
  physicsSteps?: number;
  kinematicState?: TeleoperationKinematicStateV1;
}

export interface TeleoperationResetCommandV1 extends TeleoperationCommandBaseV1 {
  command: 'reset';
  stateId?: TeleoperationStateId;
}

export interface TeleoperationReleaseCommandV1 extends TeleoperationCommandBaseV1 {
  command: 'release';
}

export interface TeleoperationPingCommandV1 extends TeleoperationCommandBaseV1 {
  command: 'ping';
  leaseId: string;
}

export interface TeleoperationRecordStartCommandV1 extends TeleoperationCommandBaseV1 {
  command: 'record.start';
}

export interface TeleoperationRecordStopCommandV1 extends TeleoperationCommandBaseV1 {
  command: 'record.stop';
}

export interface TeleoperationRecordSaveCommandV1 extends TeleoperationCommandBaseV1 {
  command: 'record.save';
  /** Small JSON object stored with the episode as `controller`. */
  metadata?: Record<string, unknown>;
}

export interface TeleoperationRecordDiscardCommandV1 extends TeleoperationCommandBaseV1 {
  command: 'record.discard';
}

export interface TeleoperationEpisodeUpdateCommandV1 extends TeleoperationCommandBaseV1 {
  command: 'episode.update';
  episodeId: string;
  name?: string;
  notes?: string;
}

export interface TeleoperationEpisodeDeleteCommandV1 extends TeleoperationCommandBaseV1 {
  command: 'episode.delete';
  episodeId: string;
}

export interface TeleoperationStateAppendCommandV1 extends TeleoperationCommandBaseV1 {
  command: 'state.append';
  seed: number;
  sourceRandomization: TeleoperationSourceRandomizationV1;
  /** Model rules sampled after the pose from the same seeded stream; overrides the profile's. */
  modelRandomization?: ModelRandomizationRuleV1[];
  /** Robot start pose sampled after the model rules; overrides the profile's. */
  robotRandomization?: TeleoperationRobotRandomizationV1;
}

export interface TeleoperationStateSelectCommandV1 extends TeleoperationCommandBaseV1 {
  command: 'state.select';
  stateId: TeleoperationStateId;
}

export interface TeleoperationStateDeleteCommandV1 extends TeleoperationCommandBaseV1 {
  command: 'state.delete';
  stateId: TeleoperationStateId;
}

export interface TeleoperationShutdownCommandV1 extends TeleoperationCommandBaseV1 {
  command: 'session.shutdown';
}

export type TeleoperationCommandV1 =
  | TeleoperationHelloCommandV1
  | TeleoperationDescribeCommandV1
  | TeleoperationAcquireCommandV1
  | TeleoperationStepCommandV1
  | TeleoperationResetCommandV1
  | TeleoperationReleaseCommandV1
  | TeleoperationPingCommandV1
  | TeleoperationRecordStartCommandV1
  | TeleoperationRecordStopCommandV1
  | TeleoperationRecordSaveCommandV1
  | TeleoperationRecordDiscardCommandV1
  | TeleoperationEpisodeUpdateCommandV1
  | TeleoperationEpisodeDeleteCommandV1
  | TeleoperationStateAppendCommandV1
  | TeleoperationStateSelectCommandV1
  | TeleoperationStateDeleteCommandV1
  | TeleoperationShutdownCommandV1;

export type TeleoperationAttachmentKindV1 =
  'qpos' | 'qvel' | 'act' | 'ctrl' | 'body-position' | 'body-quaternion' | 'camera';

export interface TeleoperationAttachmentDescriptorV1 {
  name: string;
  kind: TeleoperationAttachmentKindV1;
  dtype: 'float64' | 'uint8';
  shape: number[];
  byteLength: number;
  encoding?: 'raw-le' | 'jpeg';
}

export interface TeleoperationStreamHeaderV1 {
  protocolVersion: TeleoperationProtocolVersion;
  messageType: 'state';
  sessionId: string;
  collectionId: string;
  sceneId: string;
  sceneFingerprint: string;
  sequence: number;
  stepId: number;
  stateRevision: number;
  stateId: TeleoperationStateId;
  recording: TeleoperationRecordingStatus;
  episodeId?: string;
  wallTime: string;
  simulationTime: number;
  dimensions: {
    nq: number;
    nv: number;
    nu: number;
    nbody: number;
  };
  attachments: TeleoperationAttachmentDescriptorV1[];
}

export type TeleoperationResultV1 =
  | {
      kind: 'hello';
      supportedVersions: TeleoperationProtocolVersion[];
    }
  | {
      kind: 'describe';
      profile: TeleoperationProfileV1;
      collection: TeleoperationCollectionSummaryV1;
    }
  | { kind: 'acquire'; leaseId: string; stateRevision: number }
  | { kind: 'step'; stepId: number; simulationTime: number; stateRevision: number }
  | { kind: 'reset'; stateId: TeleoperationStateId; stateRevision: number; stepId: number }
  | { kind: 'release'; released: true }
  | { kind: 'ping'; serverTime: number }
  | { kind: 'record.start'; episodeId: string }
  | {
      kind: 'record.stop';
      pendingRecording: TeleoperationPendingRecordingV1 | null;
    }
  | { kind: 'record.save'; episode: TeleoperationEpisodeSummaryV1 }
  | { kind: 'record.discard'; episodeId: string; discarded: true }
  | { kind: 'episode.update'; episode: TeleoperationEpisodeSummaryV1 }
  | { kind: 'episode.delete'; episode: TeleoperationEpisodeSummaryV1; deleted: true }
  | { kind: 'state.append'; state: TeleoperationStateSnapshotV1 }
  | { kind: 'state.select'; stateId: TeleoperationStateId; stateRevision: number }
  | {
      kind: 'state.delete';
      stateId: TeleoperationStateId;
      deleted: true;
      activeStateId: TeleoperationStateId;
      stateRevision: number;
    }
  | { kind: 'session.shutdown'; stopped: true };

export type TeleoperationErrorCode =
  | 'PROTOCOL_VERSION_UNSUPPORTED'
  | 'MALFORMED_COMMAND'
  | 'SESSION_MISMATCH'
  | 'REQUEST_ID_STALE'
  | 'LEASE_REQUIRED'
  | 'ALREADY_ACQUIRED'
  | 'LEASE_INVALID'
  | 'STATE_REVISION_STALE'
  | 'STATE_NOT_FOUND'
  | 'STATE_DELETE_FORBIDDEN'
  | 'STATE_CHANGE_DURING_RECORDING'
  | 'RECORDING_NOT_ACTIVE'
  | 'RECORDING_ALREADY_ACTIVE'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_NON_FINITE'
  | 'TARGET_OUT_OF_RANGE'
  | 'TARGET_INCOMPLETE'
  | 'PHYSICS_STEPS_INVALID'
  | 'SCENE_CHANGED'
  | 'CAPTURE_FAILED'
  | 'SESSION_STOPPING'
  | 'SESSION_INVALIDATED'
  | 'BATCH_ACTIVE'
  | 'SAVE_IN_PROGRESS'
  | 'COLLECTION_LOCKED'
  | 'TRANSPORT_ERROR';

export interface TeleoperationErrorV1 {
  code: TeleoperationErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface TeleoperationSuccessResponseV1 {
  protocolVersion: TeleoperationProtocolVersion;
  sessionId: string;
  clientId: string;
  requestId: number;
  ok: true;
  result: TeleoperationResultV1;
}

export interface TeleoperationErrorResponseV1 {
  protocolVersion: TeleoperationProtocolVersion;
  sessionId: string;
  clientId: string;
  requestId: number;
  ok: false;
  error: TeleoperationErrorV1;
}

export type TeleoperationResponseV1 = TeleoperationSuccessResponseV1 | TeleoperationErrorResponseV1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function addIssue(
  issues: EvaluationValidationIssue[],
  path: string,
  message: string,
  code: EvaluationValidationIssue['code'],
): void {
  issues.push({ path, message, code });
}

function validateName(value: unknown, path: string, issues: EvaluationValidationIssue[]): boolean {
  if (!isNonEmptyString(value)) {
    addIssue(issues, path, 'must be a non-empty string', 'type');
    return false;
  }
  return true;
}

function validateRange(value: unknown, path: string, issues: EvaluationValidationIssue[]): boolean {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !isFiniteNumber(value[0]) ||
    !isFiniteNumber(value[1])
  ) {
    addIssue(issues, path, 'must be a pair of finite numbers', 'type');
    return false;
  }
  if (value[0] > value[1]) addIssue(issues, path, 'minimum must not exceed maximum', 'value');
  return true;
}

export function validateTeleoperationRobotRandomization(
  value: unknown,
  path: string,
  issues: EvaluationValidationIssue[],
): void {
  if (!isRecord(value)) {
    addIssue(issues, path, 'must be an object', 'type');
    return;
  }
  if (typeof value.enabled !== 'boolean') {
    addIssue(issues, `${path}.enabled`, 'must be boolean', 'type');
  }
  validateRange(value.degrees, `${path}.degrees`, issues);
  if (
    value.joints !== undefined &&
    (!Array.isArray(value.joints) || value.joints.some((joint) => !isNonEmptyString(joint)))
  ) {
    addIssue(issues, `${path}.joints`, 'must be an array of joint names', 'type');
  }
}

function validateBackdrop(value: unknown, path: string, issues: EvaluationValidationIssue[]): void {
  if (!isRecord(value)) {
    addIssue(issues, path, 'must be an object', 'type');
    return;
  }
  if (validateName(value.asset, `${path}.asset`, issues)) {
    const asset = value.asset as string;
    const segments = asset.split(/[\\/]/);
    if (
      !asset.startsWith('splats/') ||
      !isSplatPath(asset) ||
      segments.some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      addIssue(
        issues,
        `${path}.asset`,
        'must be a safe splats/*.ply or *.spz bundle path',
        'value',
      );
    }
  }
  if (value.backend !== undefined && value.backend !== 'intel-xpu') {
    addIssue(issues, `${path}.backend`, 'must be intel-xpu', 'value');
  }
  if (value.body !== undefined) validateName(value.body, `${path}.body`, issues);
  if (value.scale !== undefined && (!isFiniteNumber(value.scale) || value.scale <= 0)) {
    addIssue(issues, `${path}.scale`, 'must be a positive finite number', 'value');
  }
  if (value.rotation !== undefined) {
    const rotation = value.rotation;
    if (
      !Array.isArray(rotation) ||
      rotation.length !== 4 ||
      !rotation.every(isFiniteNumber) ||
      Math.abs(Math.hypot(...(rotation as number[])) - 1) > 1e-3
    ) {
      addIssue(
        issues,
        `${path}.rotation`,
        'must be a unit quaternion [w, x, y, z] of four finite numbers',
        'value',
      );
    }
  }
  if (
    value.hash !== undefined &&
    (typeof value.hash !== 'string' || !/^[0-9a-f]{64}$/.test(value.hash))
  ) {
    addIssue(issues, `${path}.hash`, 'must be a lowercase SHA-256 hex digest', 'value');
  }
}

function validateProfile(input: unknown): EvaluationValidationResult<TeleoperationProfileV1> {
  const issues: EvaluationValidationIssue[] = [];
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path: '$', message: 'must be an object', code: 'type' }] };
  }
  if (input.version !== TELEOPERATION_PROTOCOL_VERSION) {
    addIssue(issues, '$.version', 'must be 1', 'value');
  }
  validateName(input.name, '$.name', issues);
  validateName(input.sceneId, '$.sceneId', issues);
  validateName(input.sceneFingerprint, '$.sceneFingerprint', issues);
  if (input.inputConvention !== 'raw' && input.inputConvention !== 'so101-normalized') {
    addIssue(issues, '$.inputConvention', 'must be raw or so101-normalized', 'value');
  }
  if (!Array.isArray(input.state) || input.state.length === 0) {
    addIssue(issues, '$.state', 'must contain at least one state field', 'value');
  }
  if (!Array.isArray(input.action) || input.action.length === 0) {
    addIssue(issues, '$.action', 'must contain at least one action field', 'value');
  }
  if (!Array.isArray(input.cameras)) addIssue(issues, '$.cameras', 'must be an array', 'type');
  const physicsSteps = input.physicsSteps;
  if (
    typeof physicsSteps !== 'number' ||
    !Number.isInteger(physicsSteps) ||
    physicsSteps < 1 ||
    physicsSteps > TELEOPERATION_MAX_PHYSICS_STEPS
  ) {
    addIssue(
      issues,
      '$.physicsSteps',
      `must be an integer between 1 and ${TELEOPERATION_MAX_PHYSICS_STEPS}`,
      'value',
    );
  }
  if (
    !isFiniteNumber(input.streamHz) ||
    input.streamHz < TELEOPERATION_MIN_STREAM_HZ ||
    input.streamHz > TELEOPERATION_MAX_STREAM_HZ
  ) {
    addIssue(
      issues,
      '$.streamHz',
      `must be between ${TELEOPERATION_MIN_STREAM_HZ} and ${TELEOPERATION_MAX_STREAM_HZ} Hz`,
      'value',
    );
  }
  if (typeof input.captureRgb !== 'boolean')
    addIssue(issues, '$.captureRgb', 'must be boolean', 'type');
  const captureFps = input.captureFps;
  if (
    captureFps !== undefined &&
    (typeof captureFps !== 'number' ||
      !Number.isInteger(captureFps) ||
      captureFps < TELEOPERATION_MIN_CAPTURE_FPS ||
      captureFps > TELEOPERATION_MAX_CAPTURE_FPS)
  ) {
    addIssue(
      issues,
      '$.captureFps',
      `must be an integer between ${TELEOPERATION_MIN_CAPTURE_FPS} and ${TELEOPERATION_MAX_CAPTURE_FPS}`,
      'value',
    );
  }
  if (input.robotRandomization !== undefined) {
    validateTeleoperationRobotRandomization(
      input.robotRandomization,
      '$.robotRandomization',
      issues,
    );
  }

  if (input.backdrop !== undefined) validateBackdrop(input.backdrop, '$.backdrop', issues);

  if (input.backdropRenderBudget !== undefined) {
    if (!isRecord(input.backdropRenderBudget)) {
      addIssue(issues, '$.backdropRenderBudget', 'must be an object', 'type');
    } else {
      if (
        input.backdropRenderBudget.enabled !== undefined &&
        typeof input.backdropRenderBudget.enabled !== 'boolean'
      ) {
        addIssue(issues, '$.backdropRenderBudget.enabled', 'must be boolean', 'type');
      }
      if (
        !isFiniteNumber(input.backdropRenderBudget.maxFrameTimeMs) ||
        input.backdropRenderBudget.maxFrameTimeMs <= 0
      ) {
        addIssue(
          issues,
          '$.backdropRenderBudget.maxFrameTimeMs',
          'must be a positive finite number',
          'value',
        );
      }
    }
  }

  const randomization = input.sourceRandomization;
  if (randomization !== undefined) {
    if (!isRecord(randomization)) {
      addIssue(issues, '$.sourceRandomization', 'must be an object', 'type');
    } else {
      validateName(randomization.body, '$.sourceRandomization.body', issues);
      if (typeof randomization.enabled !== 'boolean') {
        addIssue(issues, '$.sourceRandomization.enabled', 'must be boolean', 'type');
      }
      validateRange(randomization.xCm, '$.sourceRandomization.xCm', issues);
      validateRange(randomization.yCm, '$.sourceRandomization.yCm', issues);
      validateRange(randomization.yawDegrees, '$.sourceRandomization.yawDegrees', issues);
      if (randomization.objects !== undefined) {
        if (!Array.isArray(randomization.objects)) {
          addIssue(issues, '$.sourceRandomization.objects', 'must be an array', 'type');
        } else {
          const seen = new Set<unknown>([randomization.body]);
          randomization.objects.forEach((object, index) => {
            const path = `$.sourceRandomization.objects[${index}]`;
            if (!isRecord(object)) {
              addIssue(issues, path, 'must be an object', 'type');
              return;
            }
            validateName(object.body, `${path}.body`, issues);
            if (seen.has(object.body)) {
              addIssue(issues, `${path}.body`, 'is randomized more than once', 'value');
            }
            seen.add(object.body);
            validateRange(object.xCm, `${path}.xCm`, issues);
            validateRange(object.yCm, `${path}.yCm`, issues);
            validateRange(object.yawDegrees, `${path}.yawDegrees`, issues);
          });
        }
      }
    }
  }
  const modelRules = input.modelRandomization;
  if (modelRules !== undefined) {
    if (!Array.isArray(modelRules)) {
      addIssue(issues, '$.modelRandomization', 'must be an array', 'type');
    } else {
      modelRules.forEach((rule, index) => {
        validateModelRandomizationRule(rule, `$.modelRandomization[${index}]`, issues);
      });
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: input as unknown as TeleoperationProfileV1, issues: [] };
}

export function validateTeleoperationProfileV1(
  input: unknown,
): EvaluationValidationResult<TeleoperationProfileV1> {
  return validateProfile(input);
}

export function parseTeleoperationProfileV1(input: unknown): TeleoperationProfileV1 {
  const result = validateProfile(input);
  if (!result.ok) throw new EvaluationValidationError(result.issues);
  return result.value;
}

function validateCommandBase(
  input: Record<string, unknown>,
  issues: EvaluationValidationIssue[],
): void {
  if (input.protocolVersion !== TELEOPERATION_PROTOCOL_VERSION) {
    addIssue(issues, '$.protocolVersion', 'must be 1', 'value');
  }
  validateName(input.sessionId, '$.sessionId', issues);
  validateName(input.clientId, '$.clientId', issues);
  const requestId = input.requestId;
  if (typeof requestId !== 'number' || !Number.isSafeInteger(requestId) || requestId < 1) {
    addIssue(issues, '$.requestId', 'must be a positive safe integer', 'value');
  }
  if (!isNonEmptyString(input.command)) addIssue(issues, '$.command', 'is required', 'required');
  if (input.leaseId !== undefined && !validateName(input.leaseId, '$.leaseId', issues)) {
    return;
  }
  const expectedStateRevision = input.expectedStateRevision;
  if (
    expectedStateRevision !== undefined &&
    (typeof expectedStateRevision !== 'number' ||
      !Number.isSafeInteger(expectedStateRevision) ||
      expectedStateRevision < 0)
  ) {
    addIssue(issues, '$.expectedStateRevision', 'must be a non-negative safe integer', 'value');
  }
}

function validateKinematicState(input: unknown, issues: EvaluationValidationIssue[]): void {
  if (!isRecord(input)) {
    addIssue(issues, '$.kinematicState', 'must be an object', 'type');
    return;
  }
  const jointPositions = input.jointPositions;
  if (jointPositions !== undefined) {
    if (!isRecord(jointPositions) || Object.keys(jointPositions).length === 0) {
      addIssue(issues, '$.kinematicState.jointPositions', 'must be a non-empty object', 'value');
    } else {
      for (const [name, value] of Object.entries(jointPositions)) {
        validateName(name, '$.kinematicState.jointPositions', issues);
        if (!isFiniteNumber(value)) {
          addIssue(issues, `$.kinematicState.jointPositions.${name}`, 'must be finite', 'value');
        }
      }
    }
  }
  const bodyPoses = input.bodyPoses;
  if (bodyPoses !== undefined) {
    if (!isRecord(bodyPoses) || Object.keys(bodyPoses).length === 0) {
      addIssue(issues, '$.kinematicState.bodyPoses', 'must be a non-empty object', 'value');
    } else {
      for (const [name, poseValue] of Object.entries(bodyPoses)) {
        validateName(name, '$.kinematicState.bodyPoses', issues);
        if (!isRecord(poseValue)) {
          addIssue(issues, `$.kinematicState.bodyPoses.${name}`, 'must be an object', 'type');
          continue;
        }
        const position = poseValue.position;
        if (
          !Array.isArray(position) ||
          position.length !== 3 ||
          position.some((value) => !isFiniteNumber(value))
        ) {
          addIssue(
            issues,
            `$.kinematicState.bodyPoses.${name}.position`,
            'must be a finite three-value array',
            'value',
          );
        }
        const quaternion = poseValue.quaternion;
        if (
          quaternion !== undefined &&
          (!Array.isArray(quaternion) ||
            quaternion.length !== 4 ||
            quaternion.some((value) => !isFiniteNumber(value)))
        ) {
          addIssue(
            issues,
            `$.kinematicState.bodyPoses.${name}.quaternion`,
            'must be a finite four-value array',
            'value',
          );
        }
      }
    }
  }
  if (jointPositions === undefined && bodyPoses === undefined) {
    addIssue(issues, '$.kinematicState', 'must include jointPositions or bodyPoses', 'required');
  }
}

export function validateTeleoperationCommandV1(
  input: unknown,
): EvaluationValidationResult<TeleoperationCommandV1> {
  const issues: EvaluationValidationIssue[] = [];
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path: '$', message: 'must be an object', code: 'type' }] };
  }
  validateCommandBase(input, issues);
  const command = input.command;
  if (command === 'hello') {
    if (
      !Array.isArray(input.supportedVersions) ||
      input.supportedVersions.length === 0 ||
      input.supportedVersions.some((version) => version !== TELEOPERATION_PROTOCOL_VERSION)
    ) {
      addIssue(issues, '$.supportedVersions', 'must contain protocol version 1', 'value');
    }
  } else if (command === 'acquire') {
    validateName(input.sceneFingerprint, '$.sceneFingerprint', issues);
  } else if (command === 'step') {
    if (!isRecord(input.targets) || Object.keys(input.targets).length === 0) {
      addIssue(issues, '$.targets', 'must be a non-empty object', 'value');
    } else {
      for (const [name, value] of Object.entries(input.targets)) {
        validateName(name, '$.targets', issues);
        if (!isFiniteNumber(value))
          addIssue(issues, `$.targets.${name}`, 'must be finite', 'value');
      }
    }
    const physicsSteps = input.physicsSteps;
    if (
      physicsSteps !== undefined &&
      (typeof physicsSteps !== 'number' ||
        !Number.isInteger(physicsSteps) ||
        physicsSteps < 1 ||
        physicsSteps > TELEOPERATION_MAX_PHYSICS_STEPS)
    ) {
      addIssue(
        issues,
        '$.physicsSteps',
        `must be an integer between 1 and ${TELEOPERATION_MAX_PHYSICS_STEPS}`,
        'value',
      );
    }
    if (input.kinematicState !== undefined) {
      validateKinematicState(input.kinematicState, issues);
    }
  } else if (command === 'state.append') {
    if (!Number.isSafeInteger(input.seed))
      addIssue(issues, '$.seed', 'must be a safe integer', 'value');
    if (input.modelRandomization !== undefined) {
      if (!Array.isArray(input.modelRandomization)) {
        addIssue(issues, '$.modelRandomization', 'must be an array', 'type');
      } else {
        input.modelRandomization.forEach((rule, index) =>
          validateModelRandomizationRule(rule, `$.modelRandomization[${index}]`, issues),
        );
      }
    }
    if (input.robotRandomization !== undefined) {
      validateTeleoperationRobotRandomization(
        input.robotRandomization,
        '$.robotRandomization',
        issues,
      );
    }
  } else if (command === 'record.save') {
    if (input.metadata !== undefined && !isRecord(input.metadata)) {
      addIssue(issues, '$.metadata', 'must be an object', 'type');
    }
  } else if (command === 'state.select') {
    validateName(input.stateId, '$.stateId', issues);
  } else if (command === 'state.delete') {
    validateName(input.stateId, '$.stateId', issues);
  } else if (command === 'ping') {
    validateName(input.leaseId, '$.leaseId', issues);
  } else if (command === 'episode.update' || command === 'episode.delete') {
    validateName(input.episodeId, '$.episodeId', issues);
    if (command === 'episode.update') {
      for (const key of ['name', 'notes'] as const) {
        const value = input[key];
        if (value !== undefined && typeof value !== 'string') {
          addIssue(issues, `$.${key}`, 'must be a string when provided', 'type');
        }
      }
    }
  } else if (
    command !== 'describe' &&
    command !== 'reset' &&
    command !== 'release' &&
    command !== 'ping' &&
    command !== 'record.start' &&
    command !== 'record.stop' &&
    command !== 'record.discard' &&
    command !== 'session.shutdown'
  ) {
    addIssue(issues, '$.command', 'is not supported', 'value');
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: input as unknown as TeleoperationCommandV1, issues: [] };
}
