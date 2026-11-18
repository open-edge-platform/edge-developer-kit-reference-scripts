// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { RuntimeFile } from '@mujoco-studio/mujoco';
import type { EvaluationInputConventionV1 } from '@mujoco-studio/types';
import { useSyncExternalStore } from 'react';

import { canonicalMjcf } from '@/lib/editor/mjcfSource';
import type { RangeFields } from '@/lib/generation/generationSettings';
import { sha256Hex } from '@/lib/scenes/sha256';

function inputConventionStorageKey(sceneKey: string): string {
  return `mujoco-studio.input-convention:${sceneKey}`;
}

export function readInputConventionPreference(sceneKey: string): EvaluationInputConventionV1 {
  if (typeof window === 'undefined') return 'so101-normalized';
  const value = window.localStorage.getItem(inputConventionStorageKey(sceneKey));
  return value === 'raw' || value === 'so101-normalized' ? value : 'so101-normalized';
}

export function useInputConventionPreference(
  sceneKey: string,
): [EvaluationInputConventionV1, (value: EvaluationInputConventionV1) => void, boolean] {
  const subscribe = (callback: () => void) => {
    if (typeof window === 'undefined') return () => undefined;
    window.addEventListener('storage', callback);
    window.addEventListener('mujoco-studio:input-convention', callback);
    return () => {
      window.removeEventListener('storage', callback);
      window.removeEventListener('mujoco-studio:input-convention', callback);
    };
  };
  const convention = useSyncExternalStore(
    subscribe,
    () => `${sceneKey}\n${readInputConventionPreference(sceneKey)}`,
    () => '',
  );
  const [loadedSceneKey, storedConvention] = convention.split('\n');
  const ready = loadedSceneKey === sceneKey;
  return [
    ready && (storedConvention === 'raw' || storedConvention === 'so101-normalized')
      ? storedConvention
      : 'so101-normalized',
    (value) => saveInputConventionPreference(sceneKey, value),
    ready,
  ];
}

export function saveInputConventionPreference(
  sceneKey: string,
  value: EvaluationInputConventionV1,
): void {
  if (typeof window !== 'undefined') {
    window.localStorage[inputConventionStorageKey(sceneKey)] = value;
    window.dispatchEvent(new Event('mujoco-studio:input-convention'));
  }
}

export interface SourceBody {
  body: string;
  movable: boolean;
  /** Authored world position in metres (top-level bodies are placed in the world frame). */
  position: [number, number, number];
}

function parsePosition(value: string | null): [number, number, number] {
  const parts = (value ?? '').trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return [0, 0, 0];
  return [parts[0], parts[1], parts[2]];
}

export type { RangeFields };

export function numberValue(value: string): number {
  return value.trim() ? Number(value) : Number.NaN;
}

export function rangeError(label: string, range: RangeFields): string | null {
  const minimum = numberValue(range.min);
  const maximum = numberValue(range.max);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    return `${label} range needs two finite numbers.`;
  }
  if (minimum > maximum) return `${label} minimum must not exceed maximum.`;
  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function responseFilename(response: Response): string {
  const disposition = response.headers.get('content-disposition');
  const match = disposition?.match(/filename="([^"]+)"/i);
  return match?.[1] ?? 'teleoperation-control-examples.zip';
}

export function sourceBodiesFromXml(xml: string): SourceBody[] {
  if (typeof DOMParser === 'undefined') return [];
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) return [];
  const names = new Set<string>();
  return [...document.querySelectorAll('mujoco > worldbody > body')]
    .map((body): SourceBody | null => {
      const name = body.getAttribute('name')?.trim() ?? '';
      const hasGeom = body.querySelector(':scope > geom') !== null;
      const movable = [...body.children].some(
        (child) =>
          child.tagName === 'freejoint' ||
          (child.tagName === 'joint' && child.getAttribute('type') === 'free'),
      );
      const hasRobotJoint = [...body.querySelectorAll('joint')].some((joint) =>
        ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll'].some((suffix) =>
          (joint.getAttribute('name') ?? '').endsWith(suffix),
        ),
      );
      if (!name || !hasGeom || hasRobotJoint || names.has(name)) return null;
      names.add(name);
      return { body: name, movable, position: parsePosition(body.getAttribute('pos')) };
    })
    .filter((body): body is SourceBody => body !== null);
}

export function preferredSourceBody(bodies: readonly SourceBody[]): string {
  const preferredNames = ['source', 'cube', 'object', 'asset_cube'];
  for (const preferredName of preferredNames) {
    const exact = bodies.find((body) => body.body.toLowerCase() === preferredName);
    if (exact) return exact.body;
  }
  for (const preferredName of preferredNames) {
    const partial = bodies.find((body) => body.body.toLowerCase().includes(preferredName));
    if (partial) return partial.body;
  }
  // Otherwise the first object that can move (a renamed cylinder or mug), not the first body in the
  // file, which is usually fixed scenery such as a table or a mat.
  const movable = bodies.find((body) => body.movable && !/container/i.test(body.body));
  return movable?.body ?? bodies[0]?.body ?? '';
}

/**
 * Identifies the scene content Generate data belongs to. The MJCF is compared in canonical form, so
 * re-indenting, reformatting, or editing comments keeps the same scene version.
 */
export async function fingerprint(
  xml: string,
  runtimeFiles: readonly RuntimeFile[],
): Promise<string> {
  const encoder = new TextEncoder();
  const fileNames = runtimeFiles.map((file) => `${file.kind ?? ''}:${file.path}`).sort();
  const payload = encoder.encode(`${canonicalMjcf(xml)}\n${fileNames.join('\n')}`);
  return `sha256:${await sha256Hex(payload)}`;
}

export function statusTone(status: string): string {
  if (status === 'connected' || status === 'ready') return 'text-success';
  if (status === 'error' || status === 'stale') return 'text-danger';
  if (status === 'starting' || status === 'connecting' || status === 'stopping') {
    return 'text-warning';
  }
  return 'text-muted';
}

/** Most scenes one Generate click samples. */
export const MAX_SCENES_PER_GENERATE = 500;

/** A whole number of scenes between 1 and {@link MAX_SCENES_PER_GENERATE}. */
export function clampSceneCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.round(value), 1), MAX_SCENES_PER_GENERATE);
}

/**
 * Distinct generated scenes below which a trained policy tends to memorize the start positions
 * instead of generalizing (an ACT policy trained on 19 scenes failed every held-out episode).
 * `generate_dataset.py` warns at the same count.
 */
export const RECOMMENDED_TRAINING_SCENES = 100;

export function sceneCountHint(generated: number): string | null {
  if (generated === 0 || generated >= RECOMMENDED_TRAINING_SCENES) return null;
  return `${generated} generated scene${generated === 1 ? '' : 's'}. For training a policy, generate at least ${RECOMMENDED_TRAINING_SCENES}: with fewer, it learns the start positions instead of the task.`;
}
