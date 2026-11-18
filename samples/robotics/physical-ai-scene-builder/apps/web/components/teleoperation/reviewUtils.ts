// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { TeleoperationEpisodeSummaryV1 } from '@mujoco-studio/types';

export function episodeLabel(episode: TeleoperationEpisodeSummaryV1): string {
  return episode.name?.trim() || `Episode ${episode.episodeIndex}`;
}

/**
 * API path that owns recorded episodes: the running session, or a scene version (which also serves
 * earlier versions read-only).
 */
export function episodeSourcePath(
  source: { sessionId: string } | { collectionId: string },
): string {
  return 'sessionId' in source
    ? `/api/teleoperation/sessions/${encodeURIComponent(source.sessionId)}`
    : `/api/teleoperation/versions/${encodeURIComponent(source.collectionId)}`;
}

/** Characters a same-origin API path built with `encodeURIComponent` can contain. */
export const API_PATH_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/-_.!~*'()%";

export function videoUrl(sourcePath: string, episodeId: string, cameraName: string): string {
  return `${sourcePath}/episodes/${encodeURIComponent(episodeId)}/videos/${encodeURIComponent(cameraName)}`;
}

export function formatDate(value: string | undefined): string {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = value;
  let unit = units[0];
  for (const nextUnit of units) {
    size /= 1024;
    unit = nextUnit;
    if (size < 1024 || nextUnit === units.at(-1)) break;
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${unit}`;
}
