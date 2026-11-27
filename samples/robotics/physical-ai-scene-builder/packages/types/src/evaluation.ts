// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export const EVALUATION_PROTOCOL_VERSION = 1 as const;
export const EVALUATION_MAX_PHYSICS_STEPS = 1_000;
export const EVALUATION_MAX_CAMERA_PIXELS = 4_000_000;

export type EvaluationProtocolVersion = typeof EVALUATION_PROTOCOL_VERSION;
export type EvaluationDType = 'float32' | 'uint8';
export type EvaluationLayout = 'flat' | 'HWC';
export type EvaluationColorSpace = 'rgb';
export type EvaluationRowOrientation = 'top-to-bottom';
export type EvaluationRange = readonly [number, number];
export type EvaluationShape = readonly number[];
export type EvaluationInputConventionV1 = 'raw' | 'so101-normalized';

export type EvaluationStateSourceV1 =
  | { kind: 'qpos'; component: string }
  | { kind: 'qvel'; component: string }
  | { kind: 'actuator'; actuator: string; value: 'position' | 'velocity' | 'force' }
  | { kind: 'sensor'; sensor: string; component?: number };

export interface EvaluationStateFieldV1 {
  name: string;
  source: EvaluationStateSourceV1;
  unit?: string;
  scale?: number;
  offset?: number;
}

export interface EvaluationActionFieldV1 {
  name: string;
  actuator: string;
  unit?: string;
  inputRange?: EvaluationRange;
  controlRange?: EvaluationRange;
}

export type EvaluationEulerOrderV1 = 'xyz' | 'xzy' | 'yxz' | 'yzx' | 'zxy' | 'zyx';

export interface EvaluationAxisRangesV1 {
  x: EvaluationRange;
  y: EvaluationRange;
  z: EvaluationRange;
}

export type PoseRandomizationRuleV1 =
  | {
      kind: 'free-body-position';
      body: string;
      range: EvaluationAxisRangesV1;
      /**
       * After all pose rules, drop the body onto the geometry below it and let it settle alone,
       * as Generate does for its zones (an x/y move otherwise keeps the authored height).
       */
      restOnSupport?: boolean;
    }
  | {
      kind: 'free-body-orientation-euler';
      body: string;
      order: EvaluationEulerOrderV1;
      range: EvaluationAxisRangesV1;
    }
  | {
      kind: 'free-body-orientation-quaternion';
      body: string;
      range: {
        w: EvaluationRange;
        x: EvaluationRange;
        y: EvaluationRange;
        z: EvaluationRange;
      };
    }
  | {
      kind: 'joint-position';
      joint: string;
      range: EvaluationRange;
    }
  | {
      kind: 'joint-velocity';
      joint: string;
      range: EvaluationRange;
    };

/**
 * Rules that change MjModel fields instead of the simulation state. They are sampled from the
 * same seeded stream as pose rules, applied after the model baseline is restored, and never
 * accumulate across resets.
 */
export type ModelRandomizationRuleV1 =
  | {
      kind: 'geom-color';
      target: string;
      mode: 'body' | 'geom';
      /** Hue shift in turns (1 = full colour wheel), added to the authored hue. */
      hueShift: EvaluationRange;
      /** Multipliers applied to the authored saturation and value. */
      saturationScale: EvaluationRange;
      valueScale: EvaluationRange;
    }
  | {
      kind: 'geom-material';
      geom: string;
      materials: string[];
    }
  | {
      kind: 'light';
      light: string;
      /** Symmetric per-axis position jitter in metres. */
      positionJitter: number;
      /** Symmetric per-axis direction jitter in degrees. */
      directionJitter?: number;
      diffuseScale: EvaluationRange;
    }
  | {
      kind: 'camera-pose';
      camera: string;
      /** Symmetric per-axis position jitter in metres. */
      positionJitter: number;
      /** Symmetric per-axis rotation jitter in degrees. */
      rotationJitter: number;
    }
  | {
      kind: 'camera-fov';
      camera: string;
      /** Vertical field of view in degrees, within 1..179. */
      range: EvaluationRange;
    }
  | { kind: 'body-mass'; body: string; scale: EvaluationRange }
  | {
      kind: 'geom-friction';
      target: string;
      mode: 'body' | 'geom';
      scale: { sliding: EvaluationRange; torsional?: EvaluationRange; rolling?: EvaluationRange };
    }
  | { kind: 'joint-damping'; joint: string; scale: EvaluationRange }
  | { kind: 'actuator-gain'; actuator: string; scale: EvaluationRange }
  | {
      /** HSV jitter of the rendered Gaussian-splat backdrop (never its collision geometry). */
      kind: 'backdrop-appearance';
      /** Backdrop body name (`profile.backdrop.body`, default `rs_backdrop`). */
      target: string;
      /** Hue shift in turns (1 = full colour wheel). */
      hueShift: EvaluationRange;
      saturationScale: EvaluationRange;
      valueScale: EvaluationRange;
    };

export type ModelRandomizationKindV1 = ModelRandomizationRuleV1['kind'];

export const MODEL_RANDOMIZATION_KINDS: readonly ModelRandomizationKindV1[] = [
  'geom-color',
  'geom-material',
  'light',
  'camera-pose',
  'camera-fov',
  'body-mass',
  'geom-friction',
  'joint-damping',
  'actuator-gain',
  'backdrop-appearance',
];

export type StateRandomizationRuleV1 = PoseRandomizationRuleV1 | ModelRandomizationRuleV1;

export type EvaluationBaselineV1 =
  { kind: 'model-default' } | { kind: 'captured-state'; snapshotId: string };

export interface EvaluationProfileV1 {
  version: 1;
  name: string;
  inputConvention: EvaluationInputConventionV1;
  state: EvaluationStateFieldV1[];
  action: EvaluationActionFieldV1[];
  cameras: EvaluationCameraOutputV1[];
  physicsSteps: number;
  baseline: EvaluationBaselineV1;
  randomization: StateRandomizationRuleV1[];
  actionRangePolicy?: 'reject' | 'clip';
  task?: PickPlaceTaskV1;
}

export interface PickPlaceTaskV1 {
  kind: 'pick-place';
  sourceBody: string;
  containerBody: string;
  interiorSite?: string;
  placementHalfExtents?: readonly [number, number];
  settleSeconds?: number;
  maxEpisodeSteps?: number;
  terminateOnSuccess?: boolean;
  offTableMargin?: number;
  /**
   * Arm pose (degrees by joint name) the worker settles at before each scored episode, like the
   * scripted demonstrations do before recording. A name also matches `<robot>__<name>` actions.
   */
  startPose?: { jointPositions: Record<string, number> };
}

export type EvaluationTaskV1 = PickPlaceTaskV1;

export interface EvaluationTaskStatusV1 {
  success: boolean;
  terminated: boolean;
  truncated: boolean;
  reason: string | null;
  metrics: Record<string, number>;
}

export interface EvaluationCameraOutputV1 {
  camera: string;
  outputName: string;
  width: number;
  height: number;
}

export interface EvaluationCapabilitiesV1 {
  externalControl: true;
  binaryAttachments: true;
  authoredCameraRgb: boolean;
  seededRandomization: boolean;
  capturedStateBaseline: boolean;
  taskStatus?: boolean;
}

export interface EvaluationResolvedSourceV1 {
  kind: EvaluationStateSourceV1['kind'];
  name: string;
  index: number;
  component?: number;
  value?: 'position' | 'velocity' | 'force';
}

export interface EvaluationActionDescriptionV1 {
  name: string;
  source: { name: string; index: number };
  dtype: 'float32';
  shape: readonly [1];
  unit?: string;
  inputRange?: EvaluationRange;
  controlRange?: EvaluationRange;
}

export interface EvaluationStateDescriptionV1 {
  name: string;
  source: EvaluationResolvedSourceV1;
  dtype: 'float32';
  shape: readonly [1];
  unit?: string;
  scale?: number;
  offset?: number;
}

export interface EvaluationCameraDescriptionV1 {
  name: string;
  source: { name: string; index: number };
  outputName: string;
  width: number;
  height: number;
  channels: 3;
  dtype: 'uint8';
  layout: 'HWC';
  colorSpace: EvaluationColorSpace;
  rowOrientation: EvaluationRowOrientation;
  fovDegrees?: number;
  calibration?: {
    focalLength?: readonly [number, number];
    principalPoint?: readonly [number, number];
  };
}

export interface EvaluationEnvironmentDescriptionV1 {
  protocolVersion: EvaluationProtocolVersion;
  backend: 'browser-mujoco' | 'native-worker';
  inputConvention: EvaluationInputConventionV1;
  capabilities: EvaluationCapabilitiesV1;
  sceneId: string;
  sceneRevision?: string;
  sceneFingerprint: string;
  profileId: string;
  profileVersion: 1;
  timestep: number;
  actions: EvaluationActionDescriptionV1[];
  state: EvaluationStateDescriptionV1[];
  cameras: EvaluationCameraDescriptionV1[];
  physicsSteps: number;
  randomization?: StateRandomizationRuleV1[];
  task?: EvaluationTaskV1;
  reset: {
    baselines: Array<EvaluationBaselineV1['kind']>;
    seededRandomization: boolean;
  };
}

export type EvaluationCommandKind =
  'hello' | 'describe' | 'acquire' | 'reset' | 'step' | 'render' | 'stop' | 'release' | 'ping';

export interface EvaluationCommandBaseV1 {
  protocolVersion: EvaluationProtocolVersion;
  sessionId: string;
  requestId: number;
  command: EvaluationCommandKind;
}

export interface EvaluationHelloCommandV1 extends EvaluationCommandBaseV1 {
  command: 'hello';
  supportedVersions: EvaluationProtocolVersion[];
}

export interface EvaluationDescribeCommandV1 extends EvaluationCommandBaseV1 {
  command: 'describe';
}

export interface EvaluationAcquireCommandV1 extends EvaluationCommandBaseV1 {
  command: 'acquire';
  sceneFingerprint?: string;
  profileFingerprint?: string;
}

export interface EvaluationResetCommandV1 extends EvaluationCommandBaseV1 {
  command: 'reset';
  seed?: number;
}

export interface EvaluationStepCommandV1 extends EvaluationCommandBaseV1 {
  command: 'step';
  episodeId: string;
  action: number[];
  physicsSteps?: number;
}

/** Renders the current state without stepping; needs no lease. */
export interface EvaluationRenderCommandV1 extends EvaluationCommandBaseV1 {
  command: 'render';
  /** Camera output names to render; all profile cameras when omitted. */
  cameras?: string[];
}

export interface EvaluationStopCommandV1 extends EvaluationCommandBaseV1 {
  command: 'stop';
  episodeId?: string;
}

export interface EvaluationReleaseCommandV1 extends EvaluationCommandBaseV1 {
  command: 'release';
}

export interface EvaluationPingCommandV1 extends EvaluationCommandBaseV1 {
  command: 'ping';
}

export type EvaluationCommandV1 =
  | EvaluationHelloCommandV1
  | EvaluationDescribeCommandV1
  | EvaluationAcquireCommandV1
  | EvaluationResetCommandV1
  | EvaluationStepCommandV1
  | EvaluationRenderCommandV1
  | EvaluationStopCommandV1
  | EvaluationReleaseCommandV1
  | EvaluationPingCommandV1;

export type EvaluationAttachmentKindV1 = 'state' | 'camera';

export interface EvaluationAttachmentDescriptorV1 {
  name: string;
  kind: EvaluationAttachmentKindV1;
  dtype: EvaluationDType;
  shape: EvaluationShape;
  layout: EvaluationLayout;
  byteLength: number;
  requestId: number;
  episodeId?: string;
  stepId: number;
  checksum?: string;
}

export interface EvaluationObservationHeaderV1 {
  attachments: EvaluationAttachmentDescriptorV1[];
  requestId: number;
  episodeId: string;
  stepId: number;
  simulationTime: number;
  physicsSteps: number;
}

export interface EvaluationRandomizationSampleV1 {
  ruleIndex: number;
  target: string;
  values: number[];
}

export interface EvaluationResetInfoV1 {
  seed?: number;
  samples: EvaluationRandomizationSampleV1[];
}

export type EvaluationResultV1 =
  | {
      kind: 'hello';
      backend: 'browser-mujoco' | 'native-worker';
      supportedVersions: EvaluationProtocolVersion[];
    }
  | { kind: 'describe'; description: EvaluationEnvironmentDescriptionV1 }
  | { kind: 'acquire'; leaseId: string; description: EvaluationEnvironmentDescriptionV1 }
  | {
      kind: 'reset';
      episodeId: string;
      observation: EvaluationObservationHeaderV1;
      resetInfo: EvaluationResetInfoV1;
      task?: EvaluationTaskStatusV1;
    }
  | { kind: 'step'; observation: EvaluationObservationHeaderV1; task?: EvaluationTaskStatusV1 }
  | { kind: 'render'; observation: EvaluationObservationHeaderV1 }
  | { kind: 'stop'; stopped: true }
  | { kind: 'release'; released: true }
  | { kind: 'ping'; serverTime: number };

export type EvaluationErrorCode =
  | 'PROTOCOL_VERSION_UNSUPPORTED'
  | 'MALFORMED_COMMAND'
  | 'SESSION_MISMATCH'
  | 'REQUEST_ID_STALE'
  | 'COMMAND_IN_FLIGHT'
  | 'ALREADY_ACQUIRED'
  | 'LEASE_REQUIRED'
  | 'EPISODE_REQUIRED'
  | 'EPISODE_INVALID'
  | 'EPISODE_TERMINATED'
  | 'ACTION_LENGTH_MISMATCH'
  | 'ACTION_NON_FINITE'
  | 'ACTION_OUT_OF_RANGE'
  | 'PHYSICS_STEPS_INVALID'
  | 'TARGET_NOT_FOUND'
  | 'PROFILE_INVALID'
  | 'SCENE_CHANGED'
  | 'SESSION_INVALIDATED'
  | 'CAPTURE_FAILED'
  | 'TIMEOUT'
  | 'TRANSPORT_ERROR';

export interface EvaluationErrorV1 {
  code: EvaluationErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface EvaluationSuccessResponseV1 {
  protocolVersion: EvaluationProtocolVersion;
  sessionId: string;
  requestId: number;
  ok: true;
  result: EvaluationResultV1;
}

export interface EvaluationErrorResponseV1 {
  protocolVersion: EvaluationProtocolVersion;
  sessionId: string;
  requestId: number;
  ok: false;
  error: EvaluationErrorV1;
}

export type EvaluationResponseV1 = EvaluationSuccessResponseV1 | EvaluationErrorResponseV1;

export interface EvaluationValidationIssue {
  path: string;
  message: string;
  code: 'type' | 'required' | 'value' | 'duplicate';
}

export type EvaluationValidationResult<T> =
  { ok: true; value: T; issues: readonly [] } | { ok: false; issues: EvaluationValidationIssue[] };

export class EvaluationValidationError extends Error {
  readonly issues: EvaluationValidationIssue[];

  constructor(issues: EvaluationValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
    this.name = 'EvaluationValidationError';
    this.issues = issues;
  }
}

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

function validateRange(
  value: unknown,
  path: string,
  issues: EvaluationValidationIssue[],
): value is EvaluationRange {
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

function validateName(
  value: unknown,
  path: string,
  issues: EvaluationValidationIssue[],
): value is string {
  if (!isNonEmptyString(value)) {
    addIssue(issues, path, 'must be a non-empty string', 'type');
    return false;
  }
  return true;
}

function validateAxisRanges(
  value: unknown,
  path: string,
  issues: EvaluationValidationIssue[],
): boolean {
  if (!isRecord(value)) {
    addIssue(issues, path, 'must be an object', 'type');
    return false;
  }
  let valid = true;
  for (const axis of ['x', 'y', 'z'] as const) {
    if (!validateRange(value[axis], `${path}.${axis}`, issues)) valid = false;
  }
  return valid;
}

function validateNonNegative(
  value: unknown,
  path: string,
  issues: EvaluationValidationIssue[],
): boolean {
  if (!isFiniteNumber(value) || value < 0) {
    addIssue(issues, path, 'must be a non-negative finite number', 'value');
    return false;
  }
  return true;
}

function validateScaleRange(
  value: unknown,
  path: string,
  issues: EvaluationValidationIssue[],
): boolean {
  if (!validateRange(value, path, issues)) return false;
  if (value[0] < 0) {
    addIssue(issues, path, 'must not be negative', 'value');
    return false;
  }
  return true;
}

const MODEL_RULE_TARGET_KEYS: Record<ModelRandomizationKindV1, string> = {
  'geom-color': 'target',
  'geom-material': 'geom',
  light: 'light',
  'camera-pose': 'camera',
  'camera-fov': 'camera',
  'body-mass': 'body',
  'geom-friction': 'target',
  'joint-damping': 'joint',
  'actuator-gain': 'actuator',
  'backdrop-appearance': 'target',
};

const MODEL_RULE_KEYS: Record<ModelRandomizationKindV1, readonly string[]> = {
  'geom-color': ['kind', 'target', 'mode', 'hueShift', 'saturationScale', 'valueScale'],
  'geom-material': ['kind', 'geom', 'materials'],
  light: ['kind', 'light', 'positionJitter', 'directionJitter', 'diffuseScale'],
  'camera-pose': ['kind', 'camera', 'positionJitter', 'rotationJitter'],
  'camera-fov': ['kind', 'camera', 'range'],
  'body-mass': ['kind', 'body', 'scale'],
  'geom-friction': ['kind', 'target', 'mode', 'scale'],
  'joint-damping': ['kind', 'joint', 'scale'],
  'actuator-gain': ['kind', 'actuator', 'scale'],
  'backdrop-appearance': ['kind', 'target', 'hueShift', 'saturationScale', 'valueScale'],
};

export function isModelRandomizationKind(kind: unknown): kind is ModelRandomizationKindV1 {
  return (MODEL_RANDOMIZATION_KINDS as readonly unknown[]).includes(kind);
}

/** Validate one model (appearance or physics) randomization rule; shared by Generate and Evaluate. */
export function validateModelRandomizationRule(
  value: unknown,
  path: string,
  issues: EvaluationValidationIssue[],
): boolean {
  if (!isRecord(value)) {
    addIssue(issues, path, 'must be an object', 'type');
    return false;
  }
  const kind = value.kind;
  if (!isModelRandomizationKind(kind)) {
    addIssue(issues, `${path}.kind`, 'is not a supported model randomization rule', 'value');
    return false;
  }
  const before = issues.length;
  const targetKey = MODEL_RULE_TARGET_KEYS[kind];
  validateName(value[targetKey], `${path}.${targetKey}`, issues);
  for (const key of Object.keys(value)) {
    if (!MODEL_RULE_KEYS[kind].includes(key)) {
      addIssue(issues, `${path}.${key}`, 'is not supported', 'value');
    }
  }
  if (
    (kind === 'geom-color' || kind === 'geom-friction') &&
    !['body', 'geom'].includes(value.mode as string)
  ) {
    addIssue(issues, `${path}.mode`, 'must be body or geom', 'value');
  }
  switch (kind) {
    case 'geom-color':
    case 'backdrop-appearance':
      validateRange(value.hueShift, `${path}.hueShift`, issues);
      validateScaleRange(value.saturationScale, `${path}.saturationScale`, issues);
      validateScaleRange(value.valueScale, `${path}.valueScale`, issues);
      break;
    case 'geom-material':
      if (
        !Array.isArray(value.materials) ||
        value.materials.length === 0 ||
        !value.materials.every(isNonEmptyString)
      ) {
        addIssue(
          issues,
          `${path}.materials`,
          'must be a non-empty list of material names',
          'value',
        );
      }
      break;
    case 'light':
      validateNonNegative(value.positionJitter, `${path}.positionJitter`, issues);
      if (value.directionJitter !== undefined) {
        validateNonNegative(value.directionJitter, `${path}.directionJitter`, issues);
      }
      validateScaleRange(value.diffuseScale, `${path}.diffuseScale`, issues);
      break;
    case 'camera-pose':
      validateNonNegative(value.positionJitter, `${path}.positionJitter`, issues);
      validateNonNegative(value.rotationJitter, `${path}.rotationJitter`, issues);
      break;
    case 'camera-fov':
      if (
        validateRange(value.range, `${path}.range`, issues) &&
        (value.range[0] < 1 || value.range[1] > 179)
      ) {
        addIssue(issues, `${path}.range`, 'must stay within 1 and 179 degrees', 'value');
      }
      break;
    case 'geom-friction': {
      const scale = value.scale;
      if (!isRecord(scale)) {
        addIssue(issues, `${path}.scale`, 'must be an object', 'type');
        break;
      }
      validateScaleRange(scale.sliding, `${path}.scale.sliding`, issues);
      for (const component of ['torsional', 'rolling'] as const) {
        if (scale[component] !== undefined) {
          validateScaleRange(scale[component], `${path}.scale.${component}`, issues);
        }
      }
      for (const key of Object.keys(scale)) {
        if (!['sliding', 'torsional', 'rolling'].includes(key)) {
          addIssue(issues, `${path}.scale.${key}`, 'is not supported', 'value');
        }
      }
      break;
    }
    default:
      validateScaleRange(value.scale, `${path}.scale`, issues);
  }
  return issues.length === before;
}

function validateRandomizationRule(
  value: unknown,
  path: string,
  issues: EvaluationValidationIssue[],
): boolean {
  if (!isRecord(value)) {
    addIssue(issues, path, 'must be an object', 'type');
    return false;
  }
  const kind = value.kind;
  if (isModelRandomizationKind(kind)) return validateModelRandomizationRule(value, path, issues);
  const hasBody =
    kind === 'free-body-position' ||
    kind === 'free-body-orientation-euler' ||
    kind === 'free-body-orientation-quaternion';
  const hasJoint = kind === 'joint-position' || kind === 'joint-velocity';
  if (!hasBody && !hasJoint) {
    addIssue(issues, `${path}.kind`, 'is not a supported randomization rule', 'value');
    return false;
  }

  let valid = true;
  const targetKey = hasBody ? 'body' : 'joint';
  if (!validateName(value[targetKey], `${path}.${targetKey}`, issues)) valid = false;

  if (kind === 'free-body-position' || kind === 'free-body-orientation-euler') {
    if (!validateAxisRanges(value.range, `${path}.range`, issues)) valid = false;
  } else if (kind === 'free-body-orientation-quaternion') {
    if (!isRecord(value.range)) {
      addIssue(issues, `${path}.range`, 'must be an object', 'type');
      valid = false;
    } else {
      for (const component of ['w', 'x', 'y', 'z'] as const) {
        if (!validateRange(value.range[component], `${path}.range.${component}`, issues)) {
          valid = false;
        }
      }
    }
  } else if (!validateRange(value.range, `${path}.range`, issues)) {
    valid = false;
  }

  if (
    kind === 'free-body-position' &&
    value.restOnSupport !== undefined &&
    typeof value.restOnSupport !== 'boolean'
  ) {
    addIssue(issues, `${path}.restOnSupport`, 'must be a boolean', 'type');
    valid = false;
  }
  if (
    kind === 'free-body-orientation-euler' &&
    !['xyz', 'xzy', 'yxz', 'yzx', 'zxy', 'zyx'].includes(value.order as string)
  ) {
    addIssue(issues, `${path}.order`, 'must be a supported Euler order', 'value');
    valid = false;
  }
  return valid;
}

function validateProfile(input: unknown): EvaluationValidationResult<EvaluationProfileV1> {
  const issues: EvaluationValidationIssue[] = [];
  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [{ path: '$', message: 'must be an object', code: 'type' }],
    };
  }

  if (input.version !== EVALUATION_PROTOCOL_VERSION) {
    addIssue(issues, '$.version', 'must be 1', 'value');
  }
  validateName(input.name, '$.name', issues);
  if (input.inputConvention !== 'raw' && input.inputConvention !== 'so101-normalized')
    addIssue(issues, '$.inputConvention', 'must be raw or so101-normalized', 'value');
  if (!Array.isArray(input.state)) addIssue(issues, '$.state', 'must be an array', 'type');
  if (!Array.isArray(input.action)) addIssue(issues, '$.action', 'must be an array', 'type');
  if (!Array.isArray(input.cameras)) addIssue(issues, '$.cameras', 'must be an array', 'type');
  if (!Array.isArray(input.randomization)) {
    addIssue(issues, '$.randomization', 'must be an array', 'type');
  }
  if (!isFiniteNumber(input.physicsSteps) || !Number.isInteger(input.physicsSteps)) {
    addIssue(issues, '$.physicsSteps', 'must be an integer', 'type');
  } else if (input.physicsSteps < 1 || input.physicsSteps > EVALUATION_MAX_PHYSICS_STEPS) {
    addIssue(
      issues,
      '$.physicsSteps',
      `must be between 1 and ${EVALUATION_MAX_PHYSICS_STEPS}`,
      'value',
    );
  }

  const baseline = input.baseline;
  if (
    !isRecord(baseline) ||
    !['model-default', 'captured-state'].includes(baseline.kind as string)
  ) {
    addIssue(issues, '$.baseline', 'must be a supported baseline', 'value');
  } else if (baseline.kind === 'captured-state') {
    validateName(baseline.snapshotId, '$.baseline.snapshotId', issues);
  }
  if (
    input.actionRangePolicy !== undefined &&
    !['reject', 'clip'].includes(input.actionRangePolicy as string)
  ) {
    addIssue(issues, '$.actionRangePolicy', 'must be reject or clip', 'value');
  }
  if (input.task !== undefined) {
    const task = input.task;
    if (!isRecord(task)) {
      addIssue(issues, '$.task', 'must be an object', 'type');
    } else {
      if (task.kind !== 'pick-place') {
        addIssue(issues, '$.task.kind', 'must be pick-place', 'value');
      }
      if ('sourceBody' in task) validateName(task.sourceBody, '$.task.sourceBody', issues);
      else addIssue(issues, '$.task.sourceBody', 'is required', 'required');
      if ('containerBody' in task) validateName(task.containerBody, '$.task.containerBody', issues);
      else addIssue(issues, '$.task.containerBody', 'is required', 'required');
      if (task.interiorSite !== undefined)
        validateName(task.interiorSite, '$.task.interiorSite', issues);
      if (task.placementHalfExtents !== undefined) {
        const value = task.placementHalfExtents;
        if (
          !Array.isArray(value) ||
          value.length !== 2 ||
          !value.every((entry) => isFiniteNumber(entry) && entry > 0)
        ) {
          addIssue(
            issues,
            '$.task.placementHalfExtents',
            'must contain two positive finite numbers',
            'value',
          );
        }
      }
      for (const key of ['settleSeconds', 'offTableMargin'] as const) {
        if (task[key] !== undefined && (!isFiniteNumber(task[key]) || task[key] <= 0)) {
          addIssue(issues, `$.task.${key}`, 'must be a positive finite number', 'value');
        }
      }
      if (
        task.maxEpisodeSteps !== undefined &&
        (typeof task.maxEpisodeSteps !== 'number' ||
          !Number.isInteger(task.maxEpisodeSteps) ||
          task.maxEpisodeSteps < 1)
      ) {
        addIssue(issues, '$.task.maxEpisodeSteps', 'must be a positive integer', 'value');
      }
      if (task.terminateOnSuccess !== undefined && typeof task.terminateOnSuccess !== 'boolean') {
        addIssue(issues, '$.task.terminateOnSuccess', 'must be a boolean', 'type');
      }
      if (task.startPose !== undefined) {
        const positions = (task.startPose as { jointPositions?: unknown } | null)?.jointPositions;
        if (
          !positions ||
          typeof positions !== 'object' ||
          Array.isArray(positions) ||
          Object.keys(positions).length === 0 ||
          !Object.values(positions).every(isFiniteNumber)
        ) {
          addIssue(
            issues,
            '$.task.startPose.jointPositions',
            'must map joint names to finite degrees',
            'value',
          );
        }
      }
      const allowed = new Set([
        'kind',
        'sourceBody',
        'containerBody',
        'interiorSite',
        'placementHalfExtents',
        'settleSeconds',
        'maxEpisodeSteps',
        'terminateOnSuccess',
        'offTableMargin',
        'startPose',
      ]);
      for (const key of Object.keys(task)) {
        if (!allowed.has(key)) addIssue(issues, `$.task.${key}`, 'is not supported', 'value');
      }
    }
  }

  const names = new Set<string>();
  if (Array.isArray(input.state)) {
    input.state.forEach((field, index) => {
      const path = `$.state[${index}]`;
      if (!isRecord(field)) {
        addIssue(issues, path, 'must be an object', 'type');
        return;
      }
      const fieldName = field.name;
      if (validateName(fieldName, `${path}.name`, issues)) {
        if (names.has(fieldName)) addIssue(issues, `${path}.name`, 'must be unique', 'duplicate');
        names.add(fieldName);
      }
      const source = field.source;
      if (!isRecord(source)) {
        addIssue(issues, `${path}.source`, 'must be an object', 'type');
      } else if (!['qpos', 'qvel', 'actuator', 'sensor'].includes(source.kind as string)) {
        addIssue(issues, `${path}.source.kind`, 'is not supported', 'value');
      } else if (source.kind === 'qpos' || source.kind === 'qvel') {
        validateName(source.component, `${path}.source.component`, issues);
      } else if (source.kind === 'actuator') {
        validateName(source.actuator, `${path}.source.actuator`, issues);
        if (!['position', 'velocity', 'force'].includes(source.value as string)) {
          addIssue(issues, `${path}.source.value`, 'must be position, velocity, or force', 'value');
        }
      } else {
        validateName(source.sensor, `${path}.source.sensor`, issues);
        const component = source.component;
        if (
          component !== undefined &&
          (typeof component !== 'number' || !Number.isInteger(component) || component < 0)
        ) {
          addIssue(issues, `${path}.source.component`, 'must be a non-negative integer', 'value');
        }
      }
      for (const key of ['scale', 'offset'] as const) {
        if (field[key] !== undefined && !isFiniteNumber(field[key])) {
          addIssue(issues, `${path}.${key}`, 'must be finite', 'type');
        }
      }
      if (field.unit !== undefined && typeof field.unit !== 'string') {
        addIssue(issues, `${path}.unit`, 'must be a string', 'type');
      }
    });
  }

  names.clear();
  if (Array.isArray(input.action)) {
    input.action.forEach((field, index) => {
      const path = `$.action[${index}]`;
      if (!isRecord(field)) {
        addIssue(issues, path, 'must be an object', 'type');
        return;
      }
      const fieldName = field.name;
      if (validateName(fieldName, `${path}.name`, issues)) {
        if (names.has(fieldName)) addIssue(issues, `${path}.name`, 'must be unique', 'duplicate');
        names.add(fieldName);
      }
      validateName(field.actuator, `${path}.actuator`, issues);
      for (const key of ['inputRange', 'controlRange'] as const) {
        if (field[key] !== undefined) validateRange(field[key], `${path}.${key}`, issues);
      }
      if (field.unit !== undefined && typeof field.unit !== 'string') {
        addIssue(issues, `${path}.unit`, 'must be a string', 'type');
      }
    });
  }

  names.clear();
  const cameraNames = new Set<string>();
  const outputNames = new Set<string>();
  if (Array.isArray(input.cameras)) {
    input.cameras.forEach((camera, index) => {
      const path = `$.cameras[${index}]`;
      if (!isRecord(camera)) {
        addIssue(issues, path, 'must be an object', 'type');
        return;
      }
      const cameraName = camera.camera;
      const outputName = camera.outputName;
      if (validateName(cameraName, `${path}.camera`, issues)) {
        if (cameraNames.has(cameraName))
          addIssue(issues, `${path}.camera`, 'must be unique', 'duplicate');
        cameraNames.add(cameraName);
      }
      if (validateName(outputName, `${path}.outputName`, issues)) {
        if (outputNames.has(outputName)) {
          addIssue(issues, `${path}.outputName`, 'must be unique', 'duplicate');
        }
        outputNames.add(outputName);
      }
      const width = camera.width;
      const height = camera.height;
      for (const [key, value] of [
        ['width', width],
        ['height', height],
      ] as const) {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
          addIssue(issues, `${path}.${key}`, 'must be a positive integer', 'value');
        }
      }
      if (
        typeof width === 'number' &&
        Number.isInteger(width) &&
        typeof height === 'number' &&
        Number.isInteger(height) &&
        width * height > EVALUATION_MAX_CAMERA_PIXELS
      ) {
        addIssue(issues, path, `must not exceed ${EVALUATION_MAX_CAMERA_PIXELS} pixels`, 'value');
      }
    });
  }

  if (Array.isArray(input.randomization)) {
    input.randomization.forEach((rule, index) => {
      validateRandomizationRule(rule, `$.randomization[${index}]`, issues);
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: input as unknown as EvaluationProfileV1, issues: [] };
}

export function validateEvaluationProfileV1(
  input: unknown,
): EvaluationValidationResult<EvaluationProfileV1> {
  return validateProfile(input);
}

function validateCommandBase(
  input: Record<string, unknown>,
  issues: EvaluationValidationIssue[],
): void {
  if (input.protocolVersion !== EVALUATION_PROTOCOL_VERSION) {
    addIssue(issues, '$.protocolVersion', 'must be 1', 'value');
  }
  validateName(input.sessionId, '$.sessionId', issues);
  if (
    typeof input.requestId !== 'number' ||
    !Number.isInteger(input.requestId) ||
    input.requestId < 1
  ) {
    addIssue(issues, '$.requestId', 'must be a positive integer', 'value');
  }
  if (!isNonEmptyString(input.command)) addIssue(issues, '$.command', 'is required', 'required');
}

export function validateEvaluationCommandV1(
  input: unknown,
): EvaluationValidationResult<EvaluationCommandV1> {
  const issues: EvaluationValidationIssue[] = [];
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path: '$', message: 'must be an object', code: 'type' }] };
  }
  validateCommandBase(input, issues);

  if (input.command === 'hello') {
    if (!Array.isArray(input.supportedVersions) || input.supportedVersions.length === 0) {
      addIssue(issues, '$.supportedVersions', 'must contain at least one version', 'value');
    } else if (input.supportedVersions.some((version) => version !== EVALUATION_PROTOCOL_VERSION)) {
      addIssue(issues, '$.supportedVersions', 'contains an unsupported version', 'value');
    }
  } else if (input.command === 'acquire') {
    for (const key of ['sceneFingerprint', 'profileFingerprint'] as const) {
      if (input[key] !== undefined) validateName(input[key], `$.${key}`, issues);
    }
  } else if (input.command === 'reset') {
    if (
      input.seed !== undefined &&
      (typeof input.seed !== 'number' ||
        !Number.isInteger(input.seed) ||
        !Number.isSafeInteger(input.seed))
    ) {
      addIssue(issues, '$.seed', 'must be a safe integer', 'value');
    }
  } else if (input.command === 'step') {
    validateName(input.episodeId, '$.episodeId', issues);
    if (!Array.isArray(input.action)) {
      addIssue(issues, '$.action', 'must be an array', 'type');
    } else if (input.action.some((value) => !isFiniteNumber(value))) {
      addIssue(issues, '$.action', 'must contain only finite numbers', 'value');
    }
    const physicsSteps = input.physicsSteps;
    if (
      physicsSteps !== undefined &&
      (typeof physicsSteps !== 'number' ||
        !Number.isInteger(physicsSteps) ||
        physicsSteps < 1 ||
        physicsSteps > EVALUATION_MAX_PHYSICS_STEPS)
    ) {
      addIssue(
        issues,
        '$.physicsSteps',
        `must be an integer between 1 and ${EVALUATION_MAX_PHYSICS_STEPS}`,
        'value',
      );
    }
  } else if (input.command === 'render') {
    if (input.cameras !== undefined) {
      if (!Array.isArray(input.cameras)) {
        addIssue(issues, '$.cameras', 'must be an array', 'type');
      } else {
        input.cameras.forEach((name, index) => validateName(name, `$.cameras[${index}]`, issues));
      }
    }
  } else if (input.command === 'stop' && input.episodeId !== undefined) {
    validateName(input.episodeId, '$.episodeId', issues);
  } else if (
    input.command !== 'describe' &&
    input.command !== 'release' &&
    input.command !== 'ping' &&
    input.command !== 'hello' &&
    input.command !== 'acquire' &&
    input.command !== 'reset' &&
    input.command !== 'step' &&
    input.command !== 'stop'
  ) {
    addIssue(issues, '$.command', 'is not supported', 'value');
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: input as unknown as EvaluationCommandV1, issues: [] };
}
