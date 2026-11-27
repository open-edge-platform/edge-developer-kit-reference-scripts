// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Units real-robot joint readings come in. `so101-normalized` is LeRobot's default SO-101 calibration
 * (joints -100..100 across the joint range, gripper 0..100), the convention Evaluate uses;
 * `degrees` is LeRobot with `use_degrees` (the gripper stays 0..100).
 */
export const HOME_POSE_UNITS = ['so101-normalized', 'degrees', 'radians'] as const;
export type HomePoseUnit = (typeof HOME_POSE_UNITS)[number];

export interface HomePoseJoint {
  name: string;
  type: 'hinge' | 'slide';
  range: readonly [number, number];
  limited: boolean;
}

function isGripper(name: string) {
  const lower = name.toLowerCase();
  return lower === 'gripper' || lower.endsWith('__gripper');
}

/** A recorded name (`shoulder_pan.pos`) matches the scene joint or a namespaced copy of it. */
function matchJoint(joints: readonly HomePoseJoint[], key: string): HomePoseJoint {
  const bare = key.replace(/\.pos$/, '');
  const exact = joints.find((joint) => joint.name === bare);
  if (exact) return exact;
  const namespaced = joints.filter((joint) => joint.name.endsWith(`__${bare}`));
  if (namespaced.length === 1) return namespaced[0];
  if (namespaced.length > 1) {
    throw new Error(
      `'${key}' matches ${namespaced.map((joint) => joint.name).join(', ')}; use the full joint name.`,
    );
  }
  throw new Error(
    `'${key}' is not a joint in the scene. Scene joints: ${joints.map((joint) => joint.name).join(', ')}.`,
  );
}

function toSceneUnits(joint: HomePoseJoint, value: number, unit: HomePoseUnit): number {
  const [lower, upper] = joint.range;
  const normalized = unit === 'so101-normalized' || (unit === 'degrees' && isGripper(joint.name));
  if (normalized) {
    if (!joint.limited) {
      throw new Error(
        `Joint '${joint.name}' has no range, so a normalized value cannot be mapped.`,
      );
    }
    const low = isGripper(joint.name) ? 0 : -100;
    return lower + ((value - low) / (100 - low)) * (upper - lower);
  }
  if (unit === 'degrees' && joint.type === 'hinge') return (value * Math.PI) / 180;
  return value;
}

/** Converts recorded joint values to scene joint positions (radians or meters), by scene joint name. */
export function homePoseFromRecording(
  joints: readonly HomePoseJoint[],
  values: Readonly<Record<string, number>>,
  unit: HomePoseUnit,
): Record<string, number> {
  const entries = Object.entries(values);
  if (!entries.length) throw new Error('Give at least one joint position.');
  const positions: Record<string, number> = {};
  for (const [key, value] of entries) {
    if (!Number.isFinite(value)) throw new Error(`'${key}' must be a finite number.`);
    const joint = matchJoint(joints, key);
    if (joint.name in positions) throw new Error(`Joint '${joint.name}' is given twice.`);
    let position = toSceneUnits(joint, value, unit);
    const [lower, upper] = joint.range;
    if (joint.limited) {
      // Readings at a hard stop round a hair past it.
      const slack = (upper - lower) * 1e-3;
      if (position < lower - slack || position > upper + slack) {
        throw new Error(
          `'${key}' = ${value} (${unit}) is outside the scene range of '${joint.name}' ` +
            `[${lower.toFixed(4)}, ${upper.toFixed(4)}] ${joint.type === 'hinge' ? 'rad' : 'm'}. ` +
            'Check the unit; LeRobot SO-101 recordings are so101-normalized unless recorded with use_degrees.',
        );
      }
      position = Math.min(upper, Math.max(lower, position));
    }
    positions[joint.name] = position;
  }
  return positions;
}
