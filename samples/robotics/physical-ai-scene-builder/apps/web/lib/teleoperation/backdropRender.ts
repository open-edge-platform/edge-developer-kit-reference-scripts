// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { TELEOPERATION_DEFAULT_CAPTURE_FPS } from '@mujoco-studio/types';

/**
 * How the native worker produces backdrop camera images for the current recording:
 * `inactive` (no backdrop), `live`, `deferred` (frames slower than the live budget render when the
 * recording is saved), or `rendering` (deferred frames are rendering for a save).
 */
export type TeleoperationBackdropRenderStatus = 'inactive' | 'live' | 'deferred' | 'rendering';

export interface TeleoperationBackdropRenderProgress {
  backdropRenderStatus?: TeleoperationBackdropRenderStatus;
  /** Frames of the active or stopped recording whose backdrop images are not rendered yet. */
  backdropDeferredFrames?: number;
}

/**
 * Live budget for one recorded frame's backdrop render in interactive sessions: one capture frame.
 * A slower render switches the rest of the recording to render-at-save.
 */
export const BACKDROP_LIVE_RENDER_BUDGET_MS = 1000 / TELEOPERATION_DEFAULT_CAPTURE_FPS;

const STATUSES = new Set<string>(['inactive', 'live', 'deferred', 'rendering']);

/** Read backdrop progress fields from a worker message (stream header, describe, or pending). */
export function readBackdropRenderProgress(value: unknown): TeleoperationBackdropRenderProgress {
  if (typeof value !== 'object' || value === null) return {};
  const record = value as Record<string, unknown>;
  const progress: TeleoperationBackdropRenderProgress = {};
  if (
    typeof record.backdropRenderStatus === 'string' &&
    STATUSES.has(record.backdropRenderStatus)
  ) {
    progress.backdropRenderStatus =
      record.backdropRenderStatus as TeleoperationBackdropRenderStatus;
  }
  if (
    typeof record.backdropDeferredFrames === 'number' &&
    Number.isInteger(record.backdropDeferredFrames) &&
    record.backdropDeferredFrames >= 0
  ) {
    progress.backdropDeferredFrames = record.backdropDeferredFrames;
  }
  return progress;
}

/** The short recording note for a backdrop status, or null when there is nothing to say. */
export function backdropRenderNote(progress: TeleoperationBackdropRenderProgress): string | null {
  if (progress.backdropRenderStatus === 'rendering') return 'Rendering backdrop…';
  if (progress.backdropRenderStatus !== 'deferred') return null;
  const frames = progress.backdropDeferredFrames ?? 0;
  return frames > 0
    ? `Backdrop images will render when you save (${frames} frame${frames === 1 ? '' : 's'})`
    : 'Backdrop images will render when you save';
}
