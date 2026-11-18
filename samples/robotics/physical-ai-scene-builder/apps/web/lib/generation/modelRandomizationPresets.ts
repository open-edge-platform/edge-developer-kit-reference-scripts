// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  SPLAT_BACKDROP_BODY,
  type EvaluationRange,
  type EvaluationValidationIssue,
  type ModelRandomizationRuleV1,
  validateModelRandomizationRule,
} from '@mujoco-studio/types';

export type ModelRandomizationPreset = 'off' | 'mild' | 'strong' | 'custom';

export const MODEL_RANDOMIZATION_PRESETS: readonly ModelRandomizationPreset[] = [
  'off',
  'mild',
  'strong',
  'custom',
];

/** Named scene elements a preset may randomize. Robot bodies are never included. */
export interface ModelRandomizationTargets {
  /** Task objects: the source objects and the destination (never robot links). */
  bodies: readonly string[];
  /** Subset of `bodies` that the robot picks up; only these get physics randomization. */
  sourceBodies: readonly string[];
  lights: readonly string[];
  cameras: readonly string[];
  /** Splat backdrop body (`rs_backdrop`) when the scene has one; only then is it randomized. */
  backdrop?: string | null;
}

interface PresetAmounts {
  hueShift: EvaluationRange;
  saturationScale: EvaluationRange;
  valueScale: EvaluationRange;
  lightPosition: number;
  lightDirection: number;
  diffuseScale: EvaluationRange;
  cameraPosition: number;
  cameraRotation: number;
  massScale: EvaluationRange;
  frictionScale: EvaluationRange;
  backdropHueShift: EvaluationRange;
  backdropSaturationScale: EvaluationRange;
  backdropValueScale: EvaluationRange;
}

const AMOUNTS: Record<'mild' | 'strong', PresetAmounts> = {
  mild: {
    hueShift: [-0.05, 0.05],
    saturationScale: [0.85, 1.15],
    valueScale: [0.85, 1.15],
    lightPosition: 0.05,
    lightDirection: 5,
    diffuseScale: [0.8, 1.2],
    cameraPosition: 0.005,
    cameraRotation: 1,
    massScale: [0.9, 1.1],
    frictionScale: [0.9, 1.1],
    backdropHueShift: [-0.02, 0.02],
    backdropSaturationScale: [0.9, 1.1],
    backdropValueScale: [0.85, 1.15],
  },
  strong: {
    hueShift: [-0.15, 0.15],
    saturationScale: [0.6, 1.3],
    valueScale: [0.7, 1.3],
    lightPosition: 0.15,
    lightDirection: 15,
    diffuseScale: [0.5, 1.5],
    cameraPosition: 0.015,
    cameraRotation: 3,
    massScale: [0.7, 1.3],
    frictionScale: [0.7, 1.3],
    backdropHueShift: [-0.06, 0.06],
    backdropSaturationScale: [0.75, 1.25],
    backdropValueScale: [0.7, 1.3],
  },
};

/** Build the model rules for a preset. `off` and `custom` return no rules. */
export function modelRandomizationPresetRules(
  preset: ModelRandomizationPreset,
  targets: ModelRandomizationTargets,
): ModelRandomizationRuleV1[] {
  if (preset !== 'mild' && preset !== 'strong') return [];
  const amount = AMOUNTS[preset];
  const unique = (names: readonly string[]) => [...new Set(names.filter((name) => name.trim()))];
  return [
    ...unique(targets.bodies).map((body): ModelRandomizationRuleV1 => ({
      kind: 'geom-color',
      target: body,
      mode: 'body',
      hueShift: amount.hueShift,
      saturationScale: amount.saturationScale,
      valueScale: amount.valueScale,
    })),
    ...unique(targets.lights).map((light): ModelRandomizationRuleV1 => ({
      kind: 'light',
      light,
      positionJitter: amount.lightPosition,
      directionJitter: amount.lightDirection,
      diffuseScale: amount.diffuseScale,
    })),
    ...unique(targets.cameras).map((camera): ModelRandomizationRuleV1 => ({
      kind: 'camera-pose',
      camera,
      positionJitter: amount.cameraPosition,
      rotationJitter: amount.cameraRotation,
    })),
    ...unique(targets.sourceBodies).flatMap((body): ModelRandomizationRuleV1[] => [
      { kind: 'body-mass', body, scale: amount.massScale },
      {
        kind: 'geom-friction',
        target: body,
        mode: 'body',
        scale: { sliding: amount.frictionScale },
      },
    ]),
    ...(targets.backdrop?.trim()
      ? [
          {
            kind: 'backdrop-appearance',
            target: targets.backdrop.trim(),
            hueShift: amount.backdropHueShift,
            saturationScale: amount.backdropSaturationScale,
            valueScale: amount.backdropValueScale,
          } satisfies ModelRandomizationRuleV1,
        ]
      : []),
  ];
}

export type CustomRulesResult =
  { ok: true; rules: ModelRandomizationRuleV1[] } | { ok: false; error: string };

/** Parse and validate user-edited JSON model rules. */
export function parseCustomModelRules(text: string): CustomRulesResult {
  let value: unknown;
  try {
    value = JSON.parse(text.trim() || '[]');
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid JSON.' };
  }
  if (!Array.isArray(value)) return { ok: false, error: 'Rules must be a JSON array.' };
  const issues: EvaluationValidationIssue[] = [];
  value.forEach((rule, index) => validateModelRandomizationRule(rule, `[${index}]`, issues));
  if (issues.length > 0) {
    return {
      ok: false,
      error: issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '),
    };
  }
  return { ok: true, rules: value as ModelRandomizationRuleV1[] };
}

/** Named lights and cameras in the MJCF worldbody (browser only; empty without DOMParser). */
export function sceneLightAndCameraNames(xml: string): { lights: string[]; cameras: string[] } {
  if (typeof DOMParser === 'undefined') return { lights: [], cameras: [] };
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) return { lights: [], cameras: [] };
  const names = (selector: string) =>
    [...document.querySelectorAll(selector)]
      .map((element) => element.getAttribute('name')?.trim() ?? '')
      .filter(Boolean);
  return { lights: names('worldbody light'), cameras: names('worldbody camera') };
}

/** The splat backdrop body name when the MJCF has one (browser only; null without DOMParser). */
export function sceneBackdropBodyName(xml: string): string | null {
  if (typeof DOMParser === 'undefined') return null;
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) return null;
  const found = [...document.querySelectorAll('worldbody > body')].some(
    (body) => body.getAttribute('name') === SPLAT_BACKDROP_BODY,
  );
  return found ? SPLAT_BACKDROP_BODY : null;
}
