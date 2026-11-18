// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  JointType,
  type EvaluationActionFieldV1,
  type EvaluationCameraOutputV1,
  type EvaluationInputConventionV1,
  type EvaluationProfileV1,
  type EvaluationStateFieldV1,
} from '@mujoco-studio/types';
import type { ModelInfo } from '@mujoco-studio/types';
import type { MjData, MjModel } from '@mujoco/mujoco';

import { applyCameraClipping, type CameraClipping } from './cameraClipping';
import type { Mujoco } from './runtime';

export class EvaluationResolutionError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'EvaluationResolutionError';
    this.code = code;
    this.details = details;
  }
}

export interface ScalarJointState {
  index: number;
  name: string;
  type: 'hinge' | 'slide';
  value: number;
  range: readonly [number, number];
  limited: boolean;
  unit: 'radian' | 'meter';
}

export type ScalarJointPose = Record<string, number>;

export interface ActuatorControlState {
  index: number;
  name: string;
  value: number;
  range: readonly [number, number];
  limited: boolean;
}

export interface RemoteSimulationSnapshot {
  qpos: ArrayLike<number>;
  qvel: ArrayLike<number>;
  ctrl: ArrayLike<number>;
  act?: ArrayLike<number>;
  mocapPos?: ArrayLike<number>;
  mocapQuat?: ArrayLike<number>;
  simulationTime?: number;
}

/**
 * Owns the lifetime of a compiled `MjModel`/`MjData` pair.
 *
 * Embind handles live on the WASM heap and are not garbage collected, so every
 * instance must be explicitly disposed before another model is loaded.
 */
export class Simulation {
  readonly mujoco: Mujoco;
  readonly model: MjModel;
  readonly data: MjData;
  readonly name: string;

  private readonly decoder = new TextDecoder();
  private resetPoseQpos: Float64Array | null = null;
  private resetPoseJointPositions: ScalarJointPose | null = null;
  private actuatorControls: Omit<ActuatorControlState, 'value'>[] | null = null;
  private clipping: CameraClipping;

  constructor(mujoco: Mujoco, xml: string, name = 'scene') {
    this.mujoco = mujoco;
    this.name = name;
    this.model = mujoco.MjModel.from_xml_string(xml);
    let data: MjData | undefined;
    try {
      this.clipping = applyCameraClipping(this.model, (adr) => this.nameAt(adr));
      data = new mujoco.MjData(this.model);
      mujoco.mj_forward(this.model, data);
      this.data = data;
    } catch (error) {
      data?.delete();
      this.model.delete();
      throw error;
    }
  }

  get timestep(): number {
    return this.model.opt.timestep;
  }

  get time(): number {
    return this.data.time;
  }

  get nq(): number {
    return this.model.nq;
  }

  get nv(): number {
    return this.model.nv;
  }

  get nu(): number {
    return this.model.nu;
  }

  info(): ModelInfo {
    return {
      name: this.name,
      nbody: this.model.nbody,
      ngeom: this.model.ngeom,
      njnt: this.model.njnt,
      nq: this.model.nq,
      nu: this.model.nu,
      timestep: this.timestep,
    };
  }

  memoryInfo() {
    return {
      modelBytes: this.model.nbuffer,
      dataBytes: this.data.nbuffer,
      arenaBytes: this.data.narena,
      heapBytes: (this.model.mesh_vert as Float32Array).buffer.byteLength,
      meshTriangles: this.model.nmeshface,
      textureBytes: this.model.ntexdata,
    };
  }

  step(count = 1): void {
    for (let i = 0; i < count; i++) {
      this.mujoco.mj_step(this.model, this.data);
    }
  }

  forward(): void {
    this.mujoco.mj_forward(this.model, this.data);
  }

  applyRemoteSnapshot(snapshot: RemoteSimulationSnapshot): void {
    const qpos = this.remoteArray(snapshot.qpos, this.model.nq, 'qpos');
    const qvel = this.remoteArray(snapshot.qvel, this.model.nv, 'qvel');
    const ctrl = this.remoteArray(snapshot.ctrl, this.model.nu, 'ctrl');
    const act =
      snapshot.act === undefined ? null : this.remoteArray(snapshot.act, this.model.na, 'act');
    const mocapPos =
      snapshot.mocapPos === undefined
        ? null
        : this.remoteArray(snapshot.mocapPos, this.model.nmocap * 3, 'mocap_pos');
    const mocapQuat =
      snapshot.mocapQuat === undefined
        ? null
        : this.remoteArray(snapshot.mocapQuat, this.model.nmocap * 4, 'mocap_quat');
    (this.data.qpos as Float64Array).set(qpos);
    (this.data.qvel as Float64Array).set(qvel);
    (this.data.ctrl as Float64Array).set(ctrl);
    if (act) (this.data.act as Float64Array).set(act);
    if (mocapPos) (this.data.mocap_pos as Float64Array).set(mocapPos);
    if (mocapQuat) (this.data.mocap_quat as Float64Array).set(mocapQuat);
    if (snapshot.simulationTime !== undefined) {
      if (!Number.isFinite(snapshot.simulationTime)) {
        throw new Error('Remote simulation time must be finite.');
      }
      this.data.time = snapshot.simulationTime;
    }
    this.mujoco.mj_forward(this.model, this.data);
  }

  private remoteArray(
    source: ArrayLike<number>,
    expectedLength: number,
    label: string,
  ): Float64Array {
    if (source.length !== expectedLength) {
      throw new Error(
        `Remote ${label} snapshot has length ${source.length}; expected ${expectedLength}.`,
      );
    }
    const values = new Float64Array(source.length);
    for (let index = 0; index < source.length; index++) {
      const value = Number(source[index]);
      if (!Number.isFinite(value))
        throw new Error(`Remote ${label} snapshot contains a non-finite value.`);
      values[index] = value;
    }
    return values;
  }

  reset(): void {
    this.mujoco.mj_resetData(this.model, this.data);
    if (this.resetPoseQpos) {
      (this.data.qpos as Float64Array).set(this.resetPoseQpos);
    }
    if (this.resetPoseJointPositions) {
      this.writeJointPositions(this.resetPoseJointPositions);
    }
    this.mujoco.mj_forward(this.model, this.data);
  }

  get hasResetPose(): boolean {
    return this.resetPoseQpos !== null || this.resetPoseJointPositions !== null;
  }

  getScalarJointStates(): ScalarJointState[] {
    const jointTypes = this.model.jnt_type as Int32Array;
    const jointNames = this.model.name_jntadr as Int32Array;
    const jointRanges = this.model.jnt_range as Float64Array;
    const qposAddresses = this.model.jnt_qposadr as Int32Array;
    const states: ScalarJointState[] = [];

    for (let index = 0; index < this.model.njnt; index++) {
      const type = jointTypes[index];
      if (type !== JointType.Hinge && type !== JointType.Slide) continue;
      const lower = jointRanges[index * 2];
      const upper = jointRanges[index * 2 + 1];
      states.push({
        index,
        name: this.nameAt(jointNames[index]) || `joint_${index}`,
        type: type === JointType.Hinge ? 'hinge' : 'slide',
        value: (this.data.qpos as Float64Array)[qposAddresses[index]],
        range: [lower, upper],
        limited: lower < upper,
        unit: type === JointType.Hinge ? 'radian' : 'meter',
      });
    }
    return states;
  }

  setJointPosition(jointIndex: number, value: number): void {
    this.setJointPositions([{ jointIndex, value }]);
  }

  setJointPositions(positions: readonly { jointIndex: number; value: number }[]): void {
    const nextPositions = positions.map(({ jointIndex, value }) => {
      if (!Number.isInteger(jointIndex) || jointIndex < 0 || jointIndex >= this.model.njnt) {
        throw new Error(`Joint index ${jointIndex} is invalid.`);
      }
      if (!Number.isFinite(value)) throw new Error('Joint position must be finite.');

      const jointType = (this.model.jnt_type as Int32Array)[jointIndex];
      if (jointType !== JointType.Hinge && jointType !== JointType.Slide) {
        throw new Error('Only hinge and slide joints can be adjusted as scalar positions.');
      }
      const ranges = this.model.jnt_range as Float64Array;
      const lower = ranges[jointIndex * 2];
      const upper = ranges[jointIndex * 2 + 1];
      return {
        jointIndex,
        value: lower < upper ? Math.min(upper, Math.max(lower, value)) : value,
      };
    });
    this.writeJointPositions({}, nextPositions);
    if (nextPositions.length) this.mujoco.mj_forward(this.model, this.data);
  }

  private writeJointPositions(
    positions: ScalarJointPose,
    indexedPositions?: readonly { jointIndex: number; value: number }[],
  ): void {
    const resolved =
      indexedPositions ??
      Object.entries(positions).map(([name, value]) => {
        const joint = this.getScalarJointStates().find((candidate) => candidate.name === name);
        if (!joint) throw new Error(`Joint '${name}' is not available in the scene.`);
        if (!Number.isFinite(value)) throw new Error(`Joint '${name}' position must be finite.`);
        if (joint.limited && (value < joint.range[0] || value > joint.range[1])) {
          throw new Error(`Joint '${name}' position is outside the scene joint range.`);
        }
        return { jointIndex: joint.index, value };
      });
    const qpos = this.data.qpos as Float64Array;
    const qvel = this.data.qvel as Float64Array;
    const qposAddresses = this.model.jnt_qposadr as Int32Array;
    const dofAddresses = this.model.jnt_dofadr as Int32Array;
    for (const { jointIndex, value } of resolved) {
      qpos[qposAddresses[jointIndex]] = value;
      qvel[dofAddresses[jointIndex]] = 0;
    }
  }

  getActuatorStates(): ActuatorControlState[] {
    const ctrl = this.data.ctrl as Float64Array;
    return this.actuatorControlInfo().map((actuator) => ({
      ...actuator,
      value: ctrl[actuator.index],
    }));
  }

  setActuatorControl(actuatorIndex: number, value: number): void {
    if (!Number.isInteger(actuatorIndex) || actuatorIndex < 0 || actuatorIndex >= this.model.nu) {
      throw new Error(`Actuator index ${actuatorIndex} is invalid.`);
    }
    if (!Number.isFinite(value)) throw new Error('Actuator control must be finite.');
    const { range, limited } = this.actuatorControlInfo()[actuatorIndex];
    (this.data.ctrl as Float64Array)[actuatorIndex] = limited
      ? Math.min(range[1], Math.max(range[0], value))
      : value;
  }

  // Cached because each `model.actuator(i)` call allocates an Embind handle.
  private actuatorControlInfo(): Omit<ActuatorControlState, 'value'>[] {
    if (this.actuatorControls) return this.actuatorControls;
    const names = this.model.name_actuatoradr as Int32Array;
    this.actuatorControls = Array.from({ length: this.model.nu }, (_, index) => {
      const range = this.actuatorControlRange(index);
      return {
        index,
        name: this.nameAt(names[index]) || `actuator_${index}`,
        range: range ?? ([0, 0] as const),
        limited: range !== undefined,
      };
    });
    return this.actuatorControls;
  }

  getScalarJointPositions(): ScalarJointPose {
    return Object.fromEntries(
      this.getScalarJointStates().map((joint) => [joint.name, joint.value]),
    );
  }

  getResetPoseJointPositions(): ScalarJointPose | null {
    return this.resetPoseJointPositions ? { ...this.resetPoseJointPositions } : null;
  }

  setResetPose(positions: Readonly<ScalarJointPose>): void {
    const nextPositions = { ...positions };
    this.writeJointPositions(nextPositions);
    this.resetPoseQpos = null;
    this.resetPoseJointPositions = nextPositions;
    this.mujoco.mj_forward(this.model, this.data);
  }

  captureResetPose(): void {
    this.resetPoseQpos = new Float64Array(this.data.qpos as Float64Array);
    this.resetPoseJointPositions = this.getScalarJointPositions();
  }

  clearResetPose(): void {
    this.resetPoseQpos = null;
    this.resetPoseJointPositions = null;
  }

  evaluationProfileTemplate(
    name: string,
    inputConvention: EvaluationInputConventionV1 = 'so101-normalized',
  ): EvaluationProfileV1 {
    if (inputConvention !== 'raw' && inputConvention !== 'so101-normalized') {
      throw new EvaluationResolutionError(
        'PROFILE_INVALID',
        `Unsupported evaluation input convention '${String(inputConvention)}'.`,
        { inputConvention },
      );
    }
    const state: EvaluationStateFieldV1[] = [];
    const jointTypes = this.model.jnt_type as Int32Array;
    const jointNames = this.model.name_jntadr as Int32Array;
    let hasSo101StateTransform = false;
    for (let index = 0; index < this.model.njnt; index++) {
      const jointName = this.nameAt(jointNames[index]);
      if (
        jointName &&
        (jointTypes[index] === JointType.Hinge || jointTypes[index] === JointType.Slide)
      ) {
        const stateField: EvaluationStateFieldV1 = {
          name: jointName,
          source: { kind: 'qpos', component: jointName },
        };
        if (inputConvention === 'so101-normalized') {
          const transform = this.so101JointTransform(index, jointName);
          stateField.unit = 'so101-normalized';
          stateField.scale = transform.scale;
          stateField.offset = transform.offset;
          hasSo101StateTransform = true;
        }
        state.push(stateField);
      }
    }

    const action: EvaluationActionFieldV1[] = [];
    const actuatorNames = this.model.name_actuatoradr as Int32Array;
    let hasSo101ActionTransform = false;
    for (let index = 0; index < this.model.nu; index++) {
      const actuatorName = this.nameAt(actuatorNames[index]);
      if (!actuatorName) continue;
      const range = this.actuatorControlRange(index);
      const normalizedRange =
        inputConvention === 'so101-normalized'
          ? this.isSo101Gripper(actuatorName)
            ? ([0, 100] as const)
            : ([-100, 100] as const)
          : range;
      if (inputConvention === 'so101-normalized' && range) hasSo101ActionTransform = true;
      action.push({
        name: actuatorName,
        actuator: actuatorName,
        ...(range
          ? {
              inputRange: normalizedRange,
              controlRange: range,
              ...(inputConvention === 'so101-normalized' ? { unit: 'so101-normalized' } : {}),
            }
          : {}),
      });
    }

    if (
      inputConvention === 'so101-normalized' &&
      !hasSo101StateTransform &&
      !hasSo101ActionTransform
    ) {
      throw new EvaluationResolutionError(
        'PROFILE_INVALID',
        'SO-101 normalized input requires at least one mapped joint or limited actuator.',
      );
    }

    const cameras: EvaluationCameraOutputV1[] = [];
    const cameraNames = this.model.name_camadr as Int32Array;
    for (let index = 0; index < this.model.ncam; index++) {
      const cameraName = this.nameAt(cameraNames[index]);
      if (!cameraName) continue;
      cameras.push({ camera: cameraName, outputName: cameraName, ...this.cameraOutputSize(index) });
    }

    return {
      version: 1,
      name,
      inputConvention,
      state,
      action,
      cameras,
      physicsSteps: 1,
      baseline: this.hasResetPose
        ? { kind: 'captured-state', snapshotId: 'runtime-reset-pose' }
        : { kind: 'model-default' },
      randomization: [],
      actionRangePolicy: 'reject',
    };
  }

  /** Reads a null-terminated name out of the model's shared name buffer. */
  nameAt(adr: number): string {
    const names = this.model.names as Int8Array;
    let end = adr;
    while (end < names.length && names[end] !== 0) end++;
    return this.decoder.decode(new Uint8Array(names.buffer, names.byteOffset + adr, end - adr));
  }

  jointIndex(name: string): number {
    return this.indexByName(this.model.njnt, this.model.name_jntadr as Int32Array, name, 'joint');
  }

  bodyIndex(name: string): number {
    return this.indexByName(this.model.nbody, this.model.name_bodyadr as Int32Array, name, 'body');
  }

  private sensorIndex(name: string): number {
    return this.indexByName(
      this.model.nsensor,
      this.model.name_sensoradr as Int32Array,
      name,
      'sensor',
    );
  }

  private cameraIndex(name: string): number {
    return this.indexByName(this.model.ncam, this.model.name_camadr as Int32Array, name, 'camera');
  }

  private actuatorControlRange(index: number): readonly [number, number] | undefined {
    // The array getter is a memory_view<bool> in the browser Embind build and
    // cannot be marshalled. The per-actuator accessor exposes the flag as a
    // scalar without touching that unsupported array view.
    const limitedValue = this.model.actuator(index).ctrllimited as unknown;
    const limited =
      typeof limitedValue === 'object' && limitedValue !== null && 'value' in limitedValue
        ? (limitedValue as { value?: unknown }).value
        : limitedValue;
    if (!limited) return undefined;
    const ranges = this.model.actuator_ctrlrange as Float64Array;
    return [ranges[index * 2], ranges[index * 2 + 1]] as const;
  }

  private so101JointTransform(index: number, jointName: string): { scale: number; offset: number } {
    const ranges = this.model.jnt_range as Float64Array;
    const lower = ranges[index * 2];
    const upper = ranges[index * 2 + 1];
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) {
      throw new EvaluationResolutionError(
        'PROFILE_INVALID',
        `SO101-normalized state requires a finite joint range for '${jointName}'.`,
        { joint: jointName, range: [lower, upper] },
      );
    }
    const targetLower = this.isSo101Gripper(jointName) ? 0 : -100;
    const targetUpper = 100;
    const scale = (targetUpper - targetLower) / (upper - lower);
    return { scale, offset: targetLower - scale * lower };
  }

  private isSo101Gripper(name: string): boolean {
    const normalized = name.toLowerCase();
    return normalized === 'gripper' || normalized.endsWith('__gripper');
  }

  private indexByName(
    count: number,
    nameAddresses: Int32Array,
    name: string,
    kind: string,
  ): number {
    for (let index = 0; index < count; index++) {
      if (this.nameAt(nameAddresses[index]) === name) return index;
    }
    throw new EvaluationResolutionError(
      'TARGET_NOT_FOUND',
      `No ${kind} named '${name}' exists in model '${this.name}'.`,
      { kind, name },
    );
  }

  /** Live view of world-frame geom positions, 3 entries per geom. */
  get geomPositions(): Float64Array {
    return this.data.geom_xpos as Float64Array;
  }

  /** Live view of world-frame geom rotations, 9 row-major entries per geom. */
  get geomRotations(): Float64Array {
    return this.data.geom_xmat as Float64Array;
  }

  /** Live view of world-frame body positions, 3 entries per body. */
  get bodyPositions(): Float64Array {
    return this.data.xpos as Float64Array;
  }

  /** Live view of world-frame body rotations, 9 row-major entries per body. */
  get bodyRotations(): Float64Array {
    return this.data.xmat as Float64Array;
  }

  get cameraPositions(): Float64Array {
    return this.data.cam_xpos as Float64Array;
  }

  get cameraRotations(): Float64Array {
    return this.data.cam_xmat as Float64Array;
  }

  /** Camera clipping distances in meters, as applied to the compiled model (see cameraClipping.ts). */
  get cameraClipping(): CameraClipping {
    return this.clipping;
  }

  /** The image size native workers render for a camera (its `resolution`, else 224x224). */
  cameraOutputSize(index: number): { width: number; height: number } {
    const resolutions = this.model.cam_resolution as Int32Array;
    const width = resolutions[index * 2];
    const height = resolutions[index * 2 + 1];
    // MuJoCo reports [1, 1] for a camera with no authored `resolution` attribute.
    return { width: width > 1 ? width : 224, height: height > 1 ? height : 224 };
  }

  get sitePositions(): Float64Array {
    return this.data.site_xpos as Float64Array;
  }

  get siteRotations(): Float64Array {
    return this.data.site_xmat as Float64Array;
  }

  lightPosition(index: number): readonly [number, number, number] {
    const bodyId = (this.model.light_bodyid as Int32Array)[index] ?? 0;
    const local = this.model.light_pos as Float64Array;
    const bodyPosition = this.data.xpos as Float64Array;
    const bodyRotation = this.data.xmat as Float64Array;
    const localIndex = index * 3;
    const bodyIndex = bodyId * 3;
    const rotationIndex = bodyId * 9;
    return [
      bodyPosition[bodyIndex] +
        bodyRotation[rotationIndex] * local[localIndex] +
        bodyRotation[rotationIndex + 1] * local[localIndex + 1] +
        bodyRotation[rotationIndex + 2] * local[localIndex + 2],
      bodyPosition[bodyIndex + 1] +
        bodyRotation[rotationIndex + 3] * local[localIndex] +
        bodyRotation[rotationIndex + 4] * local[localIndex + 1] +
        bodyRotation[rotationIndex + 5] * local[localIndex + 2],
      bodyPosition[bodyIndex + 2] +
        bodyRotation[rotationIndex + 6] * local[localIndex] +
        bodyRotation[rotationIndex + 7] * local[localIndex + 1] +
        bodyRotation[rotationIndex + 8] * local[localIndex + 2],
    ];
  }

  lightDirection(index: number): readonly [number, number, number] {
    const bodyId = (this.model.light_bodyid as Int32Array)[index] ?? 0;
    const local = this.model.light_dir as Float64Array;
    const bodyRotation = this.data.xmat as Float64Array;
    const localIndex = index * 3;
    const rotationIndex = bodyId * 9;
    return [
      bodyRotation[rotationIndex] * local[localIndex] +
        bodyRotation[rotationIndex + 1] * local[localIndex + 1] +
        bodyRotation[rotationIndex + 2] * local[localIndex + 2],
      bodyRotation[rotationIndex + 3] * local[localIndex] +
        bodyRotation[rotationIndex + 4] * local[localIndex + 1] +
        bodyRotation[rotationIndex + 5] * local[localIndex + 2],
      bodyRotation[rotationIndex + 6] * local[localIndex] +
        bodyRotation[rotationIndex + 7] * local[localIndex + 1] +
        bodyRotation[rotationIndex + 8] * local[localIndex + 2],
    ];
  }

  dispose(): void {
    this.data.delete();
    this.model.delete();
  }
}
