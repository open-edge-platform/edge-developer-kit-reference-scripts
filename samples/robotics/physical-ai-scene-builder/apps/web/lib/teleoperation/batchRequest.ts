// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Batch-generate request validation shared by the Node route and unit tests (no Node imports). */

/** Controller IDs the Generate worker's controller registry accepts. */
export const TELEOPERATION_BATCH_CONTROLLERS = ['so101-pick-place'] as const;
export type TeleoperationBatchController = (typeof TELEOPERATION_BATCH_CONTROLLERS)[number];

export const MAX_BATCH_EPISODES_PER_STATE = 1_000;
/** Hard cap on pool processes, applied in addition to the host's CPU count. */
export const MAX_BATCH_WORKERS = 64;
export const MAX_BATCH_STATE_IDS = 10_000;
const MAX_EGL_DEVICES = 64;
const MAX_EGL_DEVICE_ID = 1_023;

export interface TeleoperationBatchStartOptions {
  stateIds: string[] | 'all';
  episodesPerState: number;
  controller: TeleoperationBatchController;
  workers: number;
  eglDevices?: number[];
}

export type TeleoperationBatchRequestResult =
  { ok: true; value: TeleoperationBatchStartOptions } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

/** Upper bound for `workers`: the host CPU count, at most {@link MAX_BATCH_WORKERS}. */
export function maxBatchWorkers(cpuCount: number): number {
  const cpus = Number.isSafeInteger(cpuCount) && cpuCount > 0 ? cpuCount : 1;
  return Math.min(MAX_BATCH_WORKERS, cpus);
}

/**
 * Validates a `POST .../batch` body. `maxWorkers` is the host limit (see {@link maxBatchWorkers}).
 * Unknown fields are dropped so only the documented `batch.start` fields reach the worker.
 */
export function parseTeleoperationBatchRequest(
  body: unknown,
  maxWorkers: number,
): TeleoperationBatchRequestResult {
  if (!isRecord(body)) return { ok: false, error: 'Batch settings must be a JSON object.' };
  const { stateIds, episodesPerState, controller, workers, eglDevices } = body;

  let parsedStateIds: string[] | 'all';
  if (stateIds === 'all') {
    parsedStateIds = 'all';
  } else if (Array.isArray(stateIds)) {
    if (stateIds.length === 0) {
      return { ok: false, error: 'stateIds must list at least one state, or be "all".' };
    }
    if (stateIds.length > MAX_BATCH_STATE_IDS) {
      return { ok: false, error: `stateIds may list at most ${MAX_BATCH_STATE_IDS} states.` };
    }
    if (!stateIds.every((id) => typeof id === 'string' && id.trim().length > 0)) {
      return { ok: false, error: 'stateIds must contain non-empty state IDs.' };
    }
    parsedStateIds = [...new Set(stateIds as string[])];
  } else {
    return { ok: false, error: 'stateIds must be "all" or an array of state IDs.' };
  }

  if (!boundedInteger(episodesPerState, 1, MAX_BATCH_EPISODES_PER_STATE)) {
    return {
      ok: false,
      error: `episodesPerState must be an integer from 1 to ${MAX_BATCH_EPISODES_PER_STATE}.`,
    };
  }

  if (
    typeof controller !== 'string' ||
    !(TELEOPERATION_BATCH_CONTROLLERS as readonly string[]).includes(controller)
  ) {
    return {
      ok: false,
      error: `controller must be one of: ${TELEOPERATION_BATCH_CONTROLLERS.join(', ')}.`,
    };
  }

  const workerLimit = Math.max(1, Math.min(MAX_BATCH_WORKERS, Math.floor(maxWorkers)));
  if (!boundedInteger(workers, 1, workerLimit)) {
    return { ok: false, error: `workers must be an integer from 1 to ${workerLimit}.` };
  }

  let parsedEglDevices: number[] | undefined;
  if (eglDevices !== undefined && eglDevices !== null) {
    if (
      !Array.isArray(eglDevices) ||
      eglDevices.length === 0 ||
      eglDevices.length > MAX_EGL_DEVICES ||
      !eglDevices.every((device) => boundedInteger(device, 0, MAX_EGL_DEVICE_ID))
    ) {
      return {
        ok: false,
        error: 'eglDevices must be a non-empty array of non-negative EGL device indices.',
      };
    }
    parsedEglDevices = [...eglDevices] as number[];
  }

  return {
    ok: true,
    value: {
      stateIds: parsedStateIds,
      episodesPerState,
      controller: controller as TeleoperationBatchController,
      workers,
      ...(parsedEglDevices ? { eglDevices: parsedEglDevices } : {}),
    },
  };
}
