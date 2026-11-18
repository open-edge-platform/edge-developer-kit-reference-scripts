// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type {
  PickPlaceTaskV1,
  PoseRandomizationRuleV1,
  TeleoperationSourceRandomizationV1,
} from '@mujoco-studio/types';

/** A top-level scene body that can take part in a Simulate task. */
export interface TaskBody {
  name: string;
  /** Has a free joint, so it can be picked up and its start position randomized. */
  free: boolean;
  /** Authored world position (top-level bodies are placed in the world frame). */
  position: readonly [number, number, number];
  /** No authored orientation, so an absolute yaw equals a yaw offset from the authored pose. */
  upright: boolean;
}

export interface TaskCandidates {
  objects: TaskBody[];
  targets: TaskBody[];
  defaultObject: string | null;
  defaultTarget: string | null;
  /** The scene has an SO-101 arm (its joint names), so the demo home pose applies. */
  so101: boolean;
}

export interface SimulateTaskSettings {
  enabled: boolean;
  object: string;
  target: string;
  /** Symmetric x/y start-position jitter of the object, in centimetres; 0 disables it. */
  jitterCm: number;
  /** Use the Generate zones instead of `jitterCm`, so both workspaces randomize the same way. */
  useGenerateZone: boolean;
  maxSteps: number;
  /** SO-101 scenes: settle the arm at the scripted demonstrations' home pose before scoring. */
  startAtHome: boolean;
}

/**
 * Where the scripted SO-101 demonstrations start recording (degrees), mirrored from
 * `DEFAULT_HOME_POSE` in integrations/python/examples/so101/generate_dataset.py; a unit test keeps
 * them equal. Policies trained on those demonstrations have only seen episodes starting here.
 */
export const SO101_DEMO_HOME_POSE: Readonly<Record<string, number>> = {
  shoulder_pan: 0.0,
  shoulder_lift: -100.0,
  elbow_flex: 86.85,
  wrist_flex: 70.92,
  wrist_roll: -90.0,
  gripper: 0.0,
};

export const TASK_JITTER_OPTIONS_CM = [0, 1, 2, 5] as const;
export const DEFAULT_TASK_JITTER_CM = 2;
export const DEFAULT_TASK_MAX_STEPS = 600;

const OBJECT_NAMES = ['cube', 'object', 'block', 'source', 'item'] as const;
const TARGET_NAMES = ['container', 'destination', 'basket', 'bin', 'tray', 'box', 'plate'] as const;
const ORIENTATION_ATTRIBUTES = ['quat', 'euler', 'axisangle', 'xyaxes', 'zaxis'] as const;
const ROBOT_JOINTS = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll'];

function parsePosition(value: string | null): [number, number, number] {
  const parts = (value ?? '').trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return [0, 0, 0];
  return [parts[0], parts[1], parts[2]];
}

function isFree(element: Element): boolean {
  return (
    element.tagName === 'freejoint' ||
    (element.tagName === 'joint' && element.getAttribute('type') === 'free')
  );
}

function preferred(bodies: readonly TaskBody[], names: readonly string[]): string | null {
  for (const name of names) {
    const exact = bodies.find((body) => body.name.toLowerCase() === name);
    if (exact) return exact.name;
  }
  for (const name of names) {
    const partial = bodies.find((body) => body.name.toLowerCase().includes(name));
    if (partial) return partial.name;
  }
  return null;
}

/** Top-level rigid bodies (not robots) that a pick-and-place task can use. */
export function findTaskCandidates(xml: string): TaskCandidates {
  const empty: TaskCandidates = {
    objects: [],
    targets: [],
    defaultObject: null,
    defaultTarget: null,
    so101: false,
  };
  if (typeof DOMParser === 'undefined') return empty;
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) return empty;
  const worldbody = document.querySelector('mujoco > worldbody');
  if (!worldbody) return empty;
  const bodies: TaskBody[] = [];
  let so101 = false;
  for (const child of worldbody.children) {
    if (child.tagName !== 'body') continue;
    const robot = [...child.querySelectorAll('joint')].some((joint) =>
      ROBOT_JOINTS.some((suffix) => (joint.getAttribute('name') ?? '').endsWith(suffix)),
    );
    if (robot) {
      so101 = true;
      continue;
    }
    const name = child.getAttribute('name')?.trim();
    if (!name || !child.querySelector(':scope > geom')) continue;
    const joints = [...child.children].filter(
      (element) => element.tagName === 'freejoint' || element.tagName === 'joint',
    );
    if (joints.length > 1 || (joints.length === 1 && !isFree(joints[0]))) continue;
    bodies.push({
      name,
      free: joints.length === 1,
      position: parsePosition(child.getAttribute('pos')),
      upright: !ORIENTATION_ATTRIBUTES.some((attribute) => child.hasAttribute(attribute)),
    });
  }
  const objects = bodies.filter((body) => body.free);
  const defaultObject = preferred(objects, OBJECT_NAMES) ?? objects[0]?.name ?? null;
  const targets = bodies.filter((body) => body.name !== defaultObject);
  const defaultTarget =
    preferred(targets, TARGET_NAMES) ??
    targets.find((body) => !/table|floor|ground/i.test(body.name))?.name ??
    null;
  return { objects, targets, defaultObject, defaultTarget, so101 };
}

/** Problem that keeps the task from starting, or null when it is ready. */
export function taskProblem(
  settings: SimulateTaskSettings,
  candidates: TaskCandidates,
): string | null {
  if (!settings.enabled) return null;
  if (candidates.objects.length === 0) {
    return 'Add a free-moving object (a body with a free joint) to score pick and place.';
  }
  if (!candidates.objects.some((body) => body.name === settings.object)) {
    return 'Choose the object to pick.';
  }
  if (!settings.target || settings.target === settings.object) {
    return 'Choose a target that is different from the object.';
  }
  if (!candidates.targets.some((body) => body.name === settings.target)) {
    return 'Choose where the object should be placed.';
  }
  return null;
}

/**
 * Reset rules for the Generate zones: an x/y position rule per object (and a yaw rule when the
 * zone has a yaw range and the object is authored upright). Unlike Generate, Simulate does not
 * redraw overlapping placements, so objects sharing a zone can occasionally start touching.
 */
export function zoneRules(
  zones: TeleoperationSourceRandomizationV1,
  candidates: TaskCandidates,
): PoseRandomizationRuleV1[] {
  const rules: PoseRandomizationRuleV1[] = [];
  for (const zone of [zones, ...(zones.objects ?? [])]) {
    const body = candidates.objects.find((candidate) => candidate.name === zone.body);
    if (!body) continue;
    const [x, y, z] = body.position;
    rules.push({
      kind: 'free-body-position',
      body: body.name,
      range: {
        x: [x + zone.xCm[0] / 100, x + zone.xCm[1] / 100],
        y: [y + zone.yCm[0] / 100, y + zone.yCm[1] / 100],
        z: [z, z],
      },
    });
    const [minYaw, maxYaw] = zone.yawDegrees;
    if (body.upright && (minYaw !== 0 || maxYaw !== 0)) {
      rules.push({
        kind: 'free-body-orientation-euler',
        body: body.name,
        order: 'xyz',
        range: { x: [0, 0], y: [0, 0], z: [(minYaw * Math.PI) / 180, (maxYaw * Math.PI) / 180] },
      });
    }
  }
  return rules;
}

/**
 * Profile fields for the worker: the pick-place check plus the object start randomization, either
 * the Generate zones (`generateZones`, with the task object as the main object) or the jitter.
 */
export function buildTaskProfile(
  settings: SimulateTaskSettings,
  candidates: TaskCandidates,
  generateZones?: TeleoperationSourceRandomizationV1,
): { task?: PickPlaceTaskV1; randomization: PoseRandomizationRuleV1[] } {
  if (!settings.enabled || taskProblem(settings, candidates)) return { randomization: [] };
  const object = candidates.objects.find((body) => body.name === settings.object);
  const task: PickPlaceTaskV1 = {
    kind: 'pick-place',
    sourceBody: settings.object,
    containerBody: settings.target,
    maxEpisodeSteps: Math.max(1, Math.round(settings.maxSteps)),
    terminateOnSuccess: true,
    ...(settings.startAtHome && candidates.so101
      ? { startPose: { jointPositions: { ...SO101_DEMO_HOME_POSE } } }
      : {}),
  };
  if (settings.useGenerateZone && generateZones) {
    return { task, randomization: zoneRules(generateZones, candidates) };
  }
  if (!object || settings.jitterCm <= 0) return { task, randomization: [] };
  const jitter = settings.jitterCm / 100;
  const [x, y, z] = object.position;
  return {
    task,
    randomization: [
      {
        kind: 'free-body-position',
        body: object.name,
        range: { x: [x - jitter, x + jitter], y: [y - jitter, y + jitter], z: [z, z] },
      },
    ],
  };
}

/** One-line description of the task for collapsed headers and status text. */
export function taskSummary(settings: SimulateTaskSettings): string {
  if (!settings.enabled) return 'Off';
  const jitter = settings.useGenerateZone
    ? ' · Generate zone'
    : settings.jitterCm > 0
      ? ` · ±${settings.jitterCm} cm`
      : '';
  return `${settings.object || '?'} → ${settings.target || '?'}${jitter}`;
}
