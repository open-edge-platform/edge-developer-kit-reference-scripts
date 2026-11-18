// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { strFromU8, unzipSync } from 'fflate';
import {
  virtualRobotCapabilities,
  VIRTUAL_ROBOT_ADAPTERS,
} from '@mujoco-studio/payload/robot-capabilities';
import { dataPath } from '@mujoco-studio/payload/storage';
import { registerSceneSessionCleanup } from '@mujoco-studio/payload/scene-runtime-cleanup';

import {
  getEvaluationScene,
  getEvaluationSession,
  onEvaluationSessionEnded,
  onEvaluationStreamStopped,
} from '../evaluation/sessionManager';
import {
  installShutdownHandler,
  resolvePythonRunner,
  serializeWorkerOperation,
  waitForExitOrForceKill,
} from '../process/pythonWorkerProcess';
import { integrationPath } from '../teleoperation/sessionManager';
import {
  resolveDeviceTarget,
  targetArguments,
  targetContainer,
  VirtualDeviceError,
} from './target';

export { VirtualDeviceError } from './target';

const STOP_TIMEOUT_MS = 5_000;
const MAX_LOG_LINES = 100;
const MAX_CALIBRATION_BYTES = 64 * 1024;
export const VIRTUAL_SO101_JOINTS = VIRTUAL_ROBOT_ADAPTERS.so101.joints;

export type VirtualSo101Joint = (typeof VIRTUAL_SO101_JOINTS)[number];

export interface VirtualServoStatus {
  id: number;
  name: VirtualSo101Joint;
  torque: boolean;
  position: number;
  goal: number;
  homingOffset: number;
  rangeMin: number;
  rangeMax: number;
  radians: number;
}

/**
 * `default`: derived from the simulated joint ranges; `file`: the uploaded calibration file;
 * `custom`: written over the serial port by a client; `none`: factory values.
 */
export type VirtualSo101Calibration = 'none' | 'default' | 'file' | 'custom';
const CALIBRATION_STATES: readonly VirtualSo101Calibration[] = [
  'none',
  'default',
  'file',
  'custom',
];

export interface ServoCalibrationEntry {
  id: number;
  drive_mode: number;
  homing_offset: number;
  range_min: number;
  range_max: number;
}

export type VirtualSo101CalibrationFile = Record<VirtualSo101Joint, ServoCalibrationEntry>;

export interface VirtualSo101Status {
  status: 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';
  evaluationSessionId: string;
  sceneId: string;
  /** Container the port is created in, or null when it is created on this computer. */
  container: string | null;
  devicePath: string | null;
  robot: string | null;
  packets: number;
  calibration: VirtualSo101Calibration | null;
  /** Name of the uploaded calibration file in use for this scene, if any. */
  calibrationFile: string | null;
  servos: VirtualServoStatus[];
  error: string | null;
  logs: string[];
}

interface VirtualDeviceRecord {
  summary: VirtualSo101Status;
  process: ChildProcess;
  exited: Promise<void>;
  stdoutBuffer: string;
}

interface VirtualDeviceState {
  current: VirtualDeviceRecord | null;
  starting: boolean;
  operationChain: Promise<void>;
  shutdownPromise: Promise<void> | null;
  installed: boolean;
}

const stateKey = Symbol.for('mujoco-studio.virtual-so101');
const stateGlobal = globalThis as typeof globalThis & { [stateKey]?: VirtualDeviceState };
const state =
  stateGlobal[stateKey] ??
  (stateGlobal[stateKey] = {
    current: null,
    starting: false,
    operationChain: Promise.resolve(),
    shutdownPromise: null,
    installed: false,
  });
installShutdownHandler(state, () => stopVirtualSo101().then(() => undefined));

function snapshot(record: VirtualDeviceRecord): VirtualSo101Status {
  return {
    ...record.summary,
    servos: record.summary.servos.map((servo) => ({ ...servo })),
    logs: [...record.summary.logs],
  };
}

function appendLog(record: VirtualDeviceRecord, line: string): void {
  record.summary.logs.push(line.slice(0, 2_000));
  if (record.summary.logs.length > MAX_LOG_LINES) record.summary.logs.shift();
}

function handleMessage(record: VirtualDeviceRecord, line: string): void {
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(line) as Record<string, unknown>;
  } catch {
    appendLog(record, line);
    return;
  }
  const summary = record.summary;
  switch (message.type) {
    case 'ready':
      summary.status = 'ready';
      summary.devicePath = typeof message.device === 'string' ? message.device : null;
      summary.robot = typeof message.robot === 'string' ? message.robot : null;
      appendLog(record, `Serial device ready at ${summary.devicePath ?? 'an unknown path'}.`);
      break;
    case 'status':
      if (typeof message.packets === 'number') summary.packets = message.packets;
      if (Array.isArray(message.servos)) summary.servos = message.servos as VirtualServoStatus[];
      if (CALIBRATION_STATES.includes(message.calibration as VirtualSo101Calibration)) {
        summary.calibration = message.calibration as VirtualSo101Calibration;
      }
      break;
    case 'error':
      summary.error = typeof message.message === 'string' ? message.message : 'Unknown error.';
      appendLog(record, summary.error);
      break;
    case 'log':
      if (typeof message.message === 'string') appendLog(record, message.message);
      break;
    default:
      break;
  }
}

export function getVirtualSo101(): VirtualSo101Status | null {
  return state.current ? snapshot(state.current) : null;
}

export interface StartVirtualSo101Input {
  /** This server's own origin, which the emulator uses to discover the Simulate session. */
  studioUrl: string;
  robot?: string;
}

export function selectVirtualSo101(xml: string, requestedRobot?: string): string {
  const robots = virtualRobotCapabilities(xml).filter((robot) => robot.adapter === 'so101');
  if (requestedRobot !== undefined) {
    const requested = requestedRobot.replace(/__$/, '');
    if (robots.some((robot) => robot.robot === requested)) return requested;
    throw new VirtualDeviceError(
      'This robot has no verified SO-101 virtual-device capability.',
      400,
    );
  }
  if (robots.length === 0) {
    throw new VirtualDeviceError(
      'This scene has no verified SO-101 virtual-device capability.',
      400,
    );
  }
  if (robots.length > 1) {
    throw new VirtualDeviceError('Choose which verified SO-101 robot to expose.', 400);
  }
  return robots[0].robot;
}

export async function startVirtualSo101(
  input: StartVirtualSo101Input,
): Promise<VirtualSo101Status> {
  if (state.starting) {
    throw new VirtualDeviceError('The virtual SO-101 is already starting.', 409);
  }
  state.starting = true;
  try {
    return await serializeWorkerOperation(state, () => startExclusive(input));
  } finally {
    state.starting = false;
  }
}

async function startExclusive(input: StartVirtualSo101Input): Promise<VirtualSo101Status> {
  const current = state.current;
  if (current && ['starting', 'ready', 'stopping'].includes(current.summary.status)) {
    throw new VirtualDeviceError('The virtual SO-101 is already running.', 409);
  }
  const session = getEvaluationSession();
  if (!session || session.status !== 'ready') {
    throw new VirtualDeviceError(
      'Turn on Stream to client in Generate first; the virtual SO-101 drives that simulation.',
      409,
    );
  }
  const scene = await getEvaluationScene(session.sessionId);
  const entries = unzipSync(new Uint8Array(await readFile(scene.scenePath)), {
    filter: (entry) => entry.name === 'scene.xml' && entry.originalSize <= 16 * 1024 * 1024,
  });
  if (!entries['scene.xml']) {
    throw new VirtualDeviceError('The streaming scene has no supported scene.xml.', 400);
  }
  const robot = selectVirtualSo101(strFromU8(entries['scene.xml']), input.robot);
  const target = await resolveDeviceTarget();
  const storedCalibration = await readStoredCalibration(session.sceneId);
  const projectPath = integrationPath();
  const runner = resolvePythonRunner(projectPath, 'teleoperation');
  const args = [
    ...runner.args,
    '-m',
    VIRTUAL_ROBOT_ADAPTERS.so101.pythonModule,
    '--studio-url',
    input.studioUrl,
    ...targetArguments(target),
    '--state-file',
    dataPath('virtual-devices', `so101-scene-${session.sceneId}.json`),
  ];
  if (storedCalibration) args.push('--calibration-file', calibrationPath(session.sceneId));
  args.push('--robot', robot);
  const existingPythonPath = process.env.PYTHONPATH
    ? `${projectPath}${path.delimiter}${process.env.PYTHONPATH}`
    : projectPath;
  const child = spawn(/* turbopackIgnore: true */ runner.command, args, {
    cwd: path.resolve(projectPath, '../..'),
    env: { ...process.env, PYTHONPATH: existingPythonPath, PYTHONUNBUFFERED: '1' },
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const record: VirtualDeviceRecord = {
    summary: {
      status: 'starting',
      evaluationSessionId: session.sessionId,
      sceneId: session.sceneId,
      container: targetContainer(target),
      devicePath: null,
      robot: null,
      packets: 0,
      calibration: null,
      calibrationFile: storedCalibration?.name ?? null,
      servos: [],
      error: null,
      logs: [],
    },
    process: child,
    exited: new Promise<void>((resolve) => child.once('exit', () => resolve())),
    stdoutBuffer: '',
  };
  state.current = record;
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    record.stdoutBuffer += chunk;
    let newline = record.stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = record.stdoutBuffer.slice(0, newline).trim();
      record.stdoutBuffer = record.stdoutBuffer.slice(newline + 1);
      if (line) handleMessage(record, line);
      newline = record.stdoutBuffer.indexOf('\n');
    }
  });
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    for (const line of chunk.split('\n')) if (line.trim()) appendLog(record, line.trimEnd());
  });
  child.stdin?.on('error', () => undefined);
  child.once('error', (error) => {
    record.summary.status = 'failed';
    record.summary.error = error.message;
  });
  record.exited.then(() => {
    if (record.summary.status === 'stopping') {
      record.summary.status = 'stopped';
    } else if (record.summary.status !== 'stopped') {
      record.summary.status = 'failed';
      if (record.summary.error === null) {
        record.summary.error = `The virtual SO-101 exited with code ${child.exitCode ?? 'unknown'}.`;
      }
    }
    record.summary.devicePath = null;
  });
  return snapshot(record);
}

export async function stopVirtualSo101(): Promise<VirtualSo101Status | null> {
  return serializeWorkerOperation(state, async () => {
    const record = state.current;
    if (!record) return null;
    if (record.process.exitCode === null && record.process.signalCode === null) {
      record.summary.status = 'stopping';
      record.process.stdin?.end(`${JSON.stringify({ type: 'stop' })}\n`);
      await waitForExitOrForceKill(record.process, {
        timeoutMs: STOP_TIMEOUT_MS,
        exited: record.exited,
        onTimeout: () => appendLog(record, 'The virtual SO-101 did not stop in time; killed it.'),
      });
      await record.exited;
    }
    if (record.summary.status !== 'failed') record.summary.status = 'stopped';
    record.summary.devicePath = null;
    return snapshot(record);
  });
}

function runningRecord(): VirtualDeviceRecord & { process: { stdin: NodeJS.WritableStream } } {
  const record = state.current;
  if (!record || record.summary.status !== 'ready' || !record.process.stdin?.writable) {
    throw new VirtualDeviceError('The virtual SO-101 is not running.', 409);
  }
  return record as VirtualDeviceRecord & { process: { stdin: NodeJS.WritableStream } };
}

function calibrationPath(sceneId: string): string {
  return dataPath('virtual-devices', `so101-scene-${sceneId}.calibration.json`);
}

interface StoredCalibration {
  name: string;
  calibration: VirtualSo101CalibrationFile;
}

async function readStoredCalibration(sceneId: string): Promise<StoredCalibration | null> {
  let text: string;
  try {
    text = await readFile(calibrationPath(sceneId), 'utf8');
  } catch {
    return null;
  }
  try {
    const stored = JSON.parse(text) as { name?: unknown; calibration?: unknown };
    return {
      name: typeof stored.name === 'string' ? stored.name : 'calibration.json',
      calibration: parseCalibrationFile(stored.calibration),
    };
  } catch {
    return null;
  }
}

/**
 * Validates a LeRobot SO-101 calibration (`{joint: {id, drive_mode, homing_offset, range_min,
 * range_max}}`, optionally wrapped in `{calibration: ...}`), mirroring the emulator's checks.
 */
export function parseCalibrationFile(value: unknown): VirtualSo101CalibrationFile {
  const isObject = (item: unknown): item is Record<string, unknown> =>
    typeof item === 'object' && item !== null && !Array.isArray(item);
  if (isObject(value) && isObject(value.calibration)) value = value.calibration;
  if (!isObject(value)) {
    throw new VirtualDeviceError(
      'The calibration must be a JSON object with one entry per SO-101 joint.',
    );
  }
  const result = {} as VirtualSo101CalibrationFile;
  VIRTUAL_SO101_JOINTS.forEach((joint, index) => {
    const entry = value[joint];
    if (!isObject(entry))
      throw new VirtualDeviceError(`The calibration has no entry for '${joint}'.`);
    const numbers = {} as Record<'homing_offset' | 'range_min' | 'range_max', number>;
    for (const key of ['homing_offset', 'range_min', 'range_max'] as const) {
      const number = entry[key];
      if (typeof number !== 'number' || !Number.isInteger(number)) {
        throw new VirtualDeviceError(`'${joint}.${key}' must be an integer.`);
      }
      numbers[key] = number;
    }
    const id = index + 1;
    if (entry.id !== undefined && entry.id !== id) {
      throw new VirtualDeviceError(`'${joint}.id' must be ${id}.`);
    }
    if ((entry.drive_mode ?? 0) !== 0) {
      throw new VirtualDeviceError(
        `'${joint}.drive_mode' must be 0; inverted servos are not supported.`,
      );
    }
    if (Math.abs(numbers.homing_offset) > 2047) {
      throw new VirtualDeviceError(`'${joint}.homing_offset' must be between -2047 and 2047.`);
    }
    if (!(
      numbers.range_min >= 0 &&
      numbers.range_min < numbers.range_max &&
      numbers.range_max <= 4095
    )) {
      throw new VirtualDeviceError(`'${joint}' needs 0 <= range_min < range_max <= 4095.`);
    }
    result[joint] = { id, drive_mode: 0, ...numbers };
  });
  return result;
}

export interface UploadCalibrationInput {
  name: unknown;
  content: unknown;
}

/** Loads an uploaded calibration file into the running device and keeps it for this scene. */
export async function uploadVirtualSo101Calibration(
  input: UploadCalibrationInput,
): Promise<VirtualSo101Status> {
  if (typeof input.content !== 'string' || input.content.length === 0) {
    throw new VirtualDeviceError('Choose a calibration JSON file.');
  }
  if (Buffer.byteLength(input.content) > MAX_CALIBRATION_BYTES) {
    throw new VirtualDeviceError('The calibration file is too large.', 413);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.content);
  } catch {
    throw new VirtualDeviceError('The calibration file is not valid JSON.');
  }
  const calibration = parseCalibrationFile(parsed);
  const name =
    typeof input.name === 'string' && input.name.trim()
      ? path.basename(input.name.trim()).slice(0, 200)
      : 'calibration.json';
  return serializeWorkerOperation(state, async () => {
    const record = runningRecord();
    const file = calibrationPath(record.summary.sceneId);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify({ name, calibration }, null, 2)}\n`);
    record.process.stdin.write(
      `${JSON.stringify({ type: 'calibrate', mode: 'file', calibration })}\n`,
    );
    record.summary.calibrationFile = name;
    return snapshot(record);
  });
}

/** Forgets the uploaded calibration file and loads the default calibration. */
export async function clearVirtualSo101Calibration(): Promise<VirtualSo101Status> {
  return serializeWorkerOperation(state, async () => {
    const record = runningRecord();
    await rm(calibrationPath(record.summary.sceneId), { force: true });
    record.process.stdin.write(`${JSON.stringify({ type: 'calibrate', mode: 'default' })}\n`);
    record.summary.calibrationFile = null;
    return snapshot(record);
  });
}

onEvaluationSessionEnded('virtual-so101', async (sessionId) => {
  if (state.current?.summary.evaluationSessionId === sessionId) await stopVirtualSo101();
});

onEvaluationStreamStopped('virtual-so101', async (sessionId) => {
  if (state.current?.summary.evaluationSessionId === sessionId) await stopVirtualSo101();
});

registerSceneSessionCleanup('virtual-so101', async (sceneId) => {
  if (state.current?.summary.sceneId === sceneId) await stopVirtualSo101();
});
