// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Obj2MjcfConversion } from './obj2mjcfApi';

export const IMAGE_TO_3D_PIPELINE_TYPES = ['512', '1024', '1024_cascade', '1536_cascade'] as const;
export type ImageTo3dPipelineType = (typeof IMAGE_TO_3D_PIPELINE_TYPES)[number];

export const IMAGE_TO_3D_MAX_BYTES = 20 * 1024 * 1024;
export const IMAGE_TO_3D_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
/** Why an image cannot be generated from, or null when it is a supported PNG/JPEG/WebP. */
export function imageTo3dImageError(image: { type: string; size: number }): string | null {
  if (!IMAGE_TO_3D_MIME_TYPES.includes(image.type)) return 'Choose a PNG, JPEG, or WebP image.';
  if (!image.size || image.size > IMAGE_TO_3D_MAX_BYTES) {
    return 'Choose an image smaller than 20 MB.';
  }
  return null;
}

/** Pipeline stages in order, used to render a determinate progress bar. */
export const IMAGE_TO_3D_STAGES = ['generating', 'converting-mesh', 'converting-mjcf'] as const;
export type ImageTo3dStage = (typeof IMAGE_TO_3D_STAGES)[number];

export type ImageTo3dEvent =
  | { type: 'stage'; stage: ImageTo3dStage; label: string }
  | { type: 'log'; line: string }
  | {
      type: 'result';
      assetId: string;
      mjcf: string;
      files: string[];
      /** Asset-library entry for the generated object, or null if saving it failed. */
      libraryAssetId: number | null;
    }
  | { type: 'error'; message: string };

/** Asset-library name for a generated object, taken from the source image's filename. */
export function objectModelAssetName(sourceFilename: string): string {
  const stem = sourceFilename
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return stem.slice(0, 120) || 'Generated object';
}

export type TrellisServiceStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface TrellisServiceState {
  status: TrellisServiceStatus;
  url: string;
  pid: number | null;
  error: string | null;
  logs: string[];
  gpuAvailable: boolean;
}

async function serviceState(response: Response): Promise<TrellisServiceState> {
  const result = (await response.json()) as TrellisServiceState & {
    errors?: { message?: string }[];
  };
  if (!response.ok) {
    throw new Error(result.errors?.[0]?.message ?? 'Could not update the image-to-3D service.');
  }
  return result;
}

/** Current status of the TRELLIS.2 service (not running until explicitly started). */
export async function getImageTo3dServiceStatus(): Promise<TrellisServiceState> {
  const response = await fetch('/api/assets/image-to-3d/service');
  return serviceState(response);
}

/** Starts the TRELLIS.2 service via `uv run`; returns immediately with status 'starting'. */
export async function startImageTo3dService(): Promise<TrellisServiceState> {
  const response = await fetch('/api/assets/image-to-3d/service', { method: 'POST' });
  return serviceState(response);
}

/** Stops the TRELLIS.2 service, freeing its GPU memory without affecting the rest of the editor. */
export async function stopImageTo3dService(): Promise<TrellisServiceState> {
  const response = await fetch('/api/assets/image-to-3d/service', { method: 'DELETE' });
  return serviceState(response);
}

/**
 * Uploads an image and runs TRELLIS.2 + glb2obj + obj2mjcf to get back an MJCF body and its
 * assets. The response streams newline-delimited `ImageTo3dEvent`s; `onEvent` is called for each
 * one so the caller can show per-stage progress and raw subprocess output as it arrives.
 */
export async function convertImageTo3d({
  image,
  pipelineType,
  onEvent,
}: {
  image: File;
  pipelineType: ImageTo3dPipelineType;
  onEvent?: (event: ImageTo3dEvent) => void;
}): Promise<Obj2MjcfConversion> {
  const body = new FormData();
  body.append('image', image);
  body.append('pipelineType', pipelineType);

  const response = await fetch('/api/assets/image-to-3d', { method: 'POST', body });

  if (!response.ok) {
    const result = (await response.json()) as {
      errors?: { message?: string }[];
    };
    throw new Error(result.errors?.[0]?.message ?? 'The image could not be converted.');
  }
  if (!response.body) {
    throw new Error('Streaming responses are not supported by this browser.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: Obj2MjcfConversion | null = null;
  const receive = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as ImageTo3dEvent;
    onEvent?.(event);
    if (event.type === 'result') {
      if (
        !event.assetId ||
        !event.mjcf ||
        !Array.isArray(event.files) ||
        !event.files.every((file) => typeof file === 'string')
      ) {
        throw new Error('The generated object response is invalid.');
      }
      result = { assetId: event.assetId, mjcf: event.mjcf, files: event.files };
    } else if (event.type === 'error') {
      throw new Error(event.message);
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) receive(line);
    }
    receive(buffer + decoder.decode());
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }

  if (!result) throw new Error('The generated object was not returned. Try again.');
  return result;
}
