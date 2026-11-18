// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Generate panel settings (randomization ranges and model rules), kept per saved scene in the
 * browser so they survive switching workspaces, editing the scene, and reloading.
 */
import { useSyncExternalStore } from 'react';

import {
  MODEL_RANDOMIZATION_PRESETS,
  type ModelRandomizationPreset,
} from './modelRandomizationPresets';

export interface RangeFields {
  min: string;
  max: string;
}

/**
 * Another movable body randomized with the main one. A shared object scatters inside the main
 * object's zone (and yaw range); otherwise it has its own zone around its authored position.
 */
export interface ExtraObjectSettings {
  body: string;
  shareZone: boolean;
  xRange: RangeFields;
  yRange: RangeFields;
  yawRange: RangeFields;
}

export const MAX_EXTRA_OBJECTS = 15;

export interface GenerationSettings {
  xRange: RangeFields;
  yRange: RangeFields;
  yawRange: RangeFields;
  /** Robot start pose: each arm joint starts this many degrees from the authored pose. */
  robotRange: RangeFields;
  modelPreset: ModelRandomizationPreset;
  customModelRulesText: string;
  extraObjects: ExtraObjectSettings[];
}

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  xRange: { min: '-2', max: '2' },
  yRange: { min: '-2', max: '2' },
  yawRange: { min: '0', max: '0' },
  robotRange: { min: '-5', max: '5' },
  modelPreset: 'off',
  customModelRulesText: '[]',
  extraObjects: [],
};

export function defaultExtraObject(body: string): ExtraObjectSettings {
  return {
    body,
    shareZone: true,
    xRange: DEFAULT_GENERATION_SETTINGS.xRange,
    yRange: DEFAULT_GENERATION_SETTINGS.yRange,
    yawRange: DEFAULT_GENERATION_SETTINGS.yawRange,
  };
}

const CHANGE_EVENT = 'mujoco-studio:generation-settings';

function storageKey(sceneKey: string): string {
  return `mujoco-studio.generation-settings:${sceneKey}`;
}

function rangeFields(value: unknown, fallback: RangeFields): RangeFields {
  if (typeof value !== 'object' || value === null) return fallback;
  const { min, max } = value as Record<string, unknown>;
  return typeof min === 'string' && typeof max === 'string' ? { min, max } : fallback;
}

function extraObjects(value: unknown): ExtraObjectSettings[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const objects: ExtraObjectSettings[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const stored = item as Record<string, unknown>;
    if (typeof stored.body !== 'string' || !stored.body || seen.has(stored.body)) continue;
    seen.add(stored.body);
    const fallback = defaultExtraObject(stored.body);
    objects.push({
      body: stored.body,
      shareZone: typeof stored.shareZone === 'boolean' ? stored.shareZone : fallback.shareZone,
      xRange: rangeFields(stored.xRange, fallback.xRange),
      yRange: rangeFields(stored.yRange, fallback.yRange),
      yawRange: rangeFields(stored.yawRange, fallback.yawRange),
    });
    if (objects.length >= MAX_EXTRA_OBJECTS) break;
  }
  return objects;
}

/** Stored settings merged over the defaults; anything missing or malformed uses the default. */
export function parseGenerationSettings(text: string | null): GenerationSettings {
  if (!text) return DEFAULT_GENERATION_SETTINGS;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return DEFAULT_GENERATION_SETTINGS;
  }
  if (typeof value !== 'object' || value === null) return DEFAULT_GENERATION_SETTINGS;
  const stored = value as Record<string, unknown>;
  const defaults = DEFAULT_GENERATION_SETTINGS;
  return {
    xRange: rangeFields(stored.xRange, defaults.xRange),
    yRange: rangeFields(stored.yRange, defaults.yRange),
    yawRange: rangeFields(stored.yawRange, defaults.yawRange),
    robotRange: rangeFields(stored.robotRange, defaults.robotRange),
    modelPreset: MODEL_RANDOMIZATION_PRESETS.includes(
      stored.modelPreset as ModelRandomizationPreset,
    )
      ? (stored.modelPreset as ModelRandomizationPreset)
      : defaults.modelPreset,
    customModelRulesText:
      typeof stored.customModelRulesText === 'string'
        ? stored.customModelRulesText
        : defaults.customModelRulesText,
    extraObjects: extraObjects(stored.extraObjects),
  };
}

function read(sceneKey: string): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(storageKey(sceneKey)) ?? '';
}

export function useGenerationSettings(
  sceneKey: string,
): [GenerationSettings, (update: Partial<GenerationSettings>) => void] {
  const subscribe = (callback: () => void) => {
    window.addEventListener('storage', callback);
    window.addEventListener(CHANGE_EVENT, callback);
    return () => {
      window.removeEventListener('storage', callback);
      window.removeEventListener(CHANGE_EVENT, callback);
    };
  };
  const text = useSyncExternalStore(
    subscribe,
    () => read(sceneKey),
    () => '',
  );
  const settings = parseGenerationSettings(text);
  const update = (changes: Partial<GenerationSettings>) => {
    const next = { ...parseGenerationSettings(read(sceneKey)), ...changes };
    try {
      window.localStorage[storageKey(sceneKey)] = JSON.stringify(next);
    } catch {
      return;
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };
  return [settings, update];
}
