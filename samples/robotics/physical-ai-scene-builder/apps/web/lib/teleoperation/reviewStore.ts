// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type {
  TeleoperationEpisodeCameraV1,
  TeleoperationEpisodeFrameV1,
  TeleoperationEpisodeImageV1,
  TeleoperationEpisodeReviewV1,
  TeleoperationEpisodeSummaryV1,
} from '@mujoco-studio/types';

export class TeleoperationReviewError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'TeleoperationReviewError';
    this.status = status;
  }
}

interface RawImageDescriptor {
  shape?: unknown;
  dtype?: unknown;
}

interface RawVideoDescriptor {
  path?: unknown;
  fps?: unknown;
  frameCount?: unknown;
  width?: unknown;
  height?: unknown;
}

interface RawEpisodeFrame {
  frameIndex?: unknown;
  timestamp?: unknown;
  state?: unknown;
  action?: unknown;
  task?: unknown;
  phase?: unknown;
  selectedObject?: unknown;
  randomization?: unknown;
  metadata?: unknown;
  images?: unknown;
}

interface RawEpisodeMetadata {
  frames?: unknown;
  videos?: unknown;
}

export interface TeleoperationVideoFile {
  path: string;
  size: number;
  contentType: 'video/mp4';
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TeleoperationReviewError('Teleoperation episode metadata is invalid.', 422);
  }
  return value as Record<string, unknown>;
}

function finiteVector(value: unknown, label: string): number[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'number' && Number.isFinite(item))
  ) {
    throw new TeleoperationReviewError(`Teleoperation ${label} is invalid.`, 422);
  }
  return value as number[];
}

function episodeDirectory(collectionDirectory: string, episodeIndex: number): string {
  if (!Number.isSafeInteger(episodeIndex) || episodeIndex < 0 || episodeIndex > 999999) {
    throw new TeleoperationReviewError('Episode index is invalid.', 400);
  }
  return path.join(
    collectionDirectory,
    'dataset',
    'episodes',
    `episode-${String(episodeIndex).padStart(6, '0')}`,
  );
}

function imageDescriptor(value: unknown, name: string): TeleoperationEpisodeImageV1 {
  const descriptor = record(value) as RawImageDescriptor;
  const shape = descriptor.shape;
  if (
    !Array.isArray(shape) ||
    shape.length !== 3 ||
    !shape.every((item) => Number.isSafeInteger(item) && item > 0) ||
    descriptor.dtype !== 'uint8'
  ) {
    throw new TeleoperationReviewError(
      `Teleoperation image '${name}' has invalid dimensions.`,
      422,
    );
  }
  return { name, width: shape[1] as number, height: shape[0] as number };
}

function randomization(value: unknown): TeleoperationEpisodeFrameV1['randomization'] {
  if (!Array.isArray(value))
    throw new TeleoperationReviewError('Teleoperation randomization is invalid.', 422);
  return value.map((sample) => {
    const item = record(sample);
    return {
      target: typeof item.target === 'string' ? item.target : '',
      values: finiteVector(item.values, 'randomization values'),
      ...(typeof item.selected === 'string' ? { selected: item.selected } : {}),
    };
  });
}

function frameFromMetadata(value: unknown): TeleoperationEpisodeFrameV1 {
  const raw = record(value) as RawEpisodeFrame;
  const frameIndex = raw.frameIndex;
  const timestamp = raw.timestamp;
  const task = raw.task;
  if (
    typeof frameIndex !== 'number' ||
    !Number.isSafeInteger(frameIndex) ||
    frameIndex < 0 ||
    typeof timestamp !== 'number' ||
    !Number.isFinite(timestamp) ||
    typeof task !== 'string'
  ) {
    throw new TeleoperationReviewError('Teleoperation frame identity is invalid.', 422);
  }
  const validFrameIndex = frameIndex as number;
  const images = Object.entries(record(raw.images ?? {})).map(([name, descriptor]) =>
    imageDescriptor(descriptor, name),
  );
  const rawMetadata = record(raw.metadata ?? {});
  const qpos =
    rawMetadata.qpos === undefined ? undefined : finiteVector(rawMetadata.qpos, 'frame qpos');
  const qvel =
    rawMetadata.qvel === undefined ? undefined : finiteVector(rawMetadata.qvel, 'frame qvel');
  const ctrl =
    rawMetadata.ctrl === undefined ? undefined : finiteVector(rawMetadata.ctrl, 'frame ctrl');
  const metadata = Object.fromEntries(
    Object.entries(rawMetadata).filter(([name]) => !['qpos', 'qvel', 'ctrl'].includes(name)),
  );
  return {
    frameIndex: validFrameIndex,
    timestamp,
    ...(qpos ? { qpos } : {}),
    ...(qvel ? { qvel } : {}),
    ...(ctrl ? { ctrl } : {}),
    state: finiteVector(raw.state, 'frame state'),
    action: finiteVector(raw.action, 'frame action'),
    task,
    phase: typeof raw.phase === 'string' ? raw.phase : null,
    selectedObject: typeof raw.selectedObject === 'string' ? raw.selectedObject : null,
    randomization: randomization(raw.randomization ?? []),
    metadata,
    images,
  };
}

function episodeVideos(
  value: unknown,
): Record<string, { path: string; fps: number; frameCount: number }> {
  if (value === undefined) return {};
  const videos: Record<string, { path: string; fps: number; frameCount: number }> = {};
  for (const [name, descriptor] of Object.entries(record(value))) {
    const video = record(descriptor) as RawVideoDescriptor;
    const relativePath = safeRelativePath(video.path);
    if (
      !relativePath ||
      !relativePath.endsWith('.mp4') ||
      typeof video.fps !== 'number' ||
      !(video.fps > 0) ||
      typeof video.frameCount !== 'number' ||
      !Number.isSafeInteger(video.frameCount)
    ) {
      throw new TeleoperationReviewError(`Teleoperation video '${name}' metadata is invalid.`, 422);
    }
    videos[name] = { path: relativePath, fps: video.fps, frameCount: video.frameCount };
  }
  return videos;
}

async function readEpisodeMetadata(
  collectionDirectory: string,
  episode: TeleoperationEpisodeSummaryV1,
): Promise<{
  review: TeleoperationEpisodeReviewV1;
  videos: Record<string, { path: string; fps: number; frameCount: number }>;
}> {
  if (episode.status !== 'recorded' || episode.frameCount < 1) {
    throw new TeleoperationReviewError('Only recorded episodes with frames can be reviewed.', 409);
  }
  const directory = episodeDirectory(collectionDirectory, episode.episodeIndex);
  let metadata: RawEpisodeMetadata;
  try {
    metadata = JSON.parse(
      await readFile(path.join(directory, 'episode.json'), 'utf8'),
    ) as RawEpisodeMetadata;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof Error) {
      throw new TeleoperationReviewError(
        'The teleoperation episode metadata could not be read.',
        422,
      );
    }
    throw error;
  }
  if (!Array.isArray(metadata.frames)) {
    throw new TeleoperationReviewError('The teleoperation episode has no frame metadata.', 422);
  }
  const frames = metadata.frames.map(frameFromMetadata);
  const videos = episodeVideos(metadata.videos);
  if (frames.length !== episode.frameCount) {
    throw new TeleoperationReviewError(
      `Episode ${episode.episodeIndex} declares ${episode.frameCount} frames but contains ${frames.length}.`,
      422,
    );
  }
  const cameras = new Map<string, TeleoperationEpisodeCameraV1>();
  for (const frame of frames) {
    for (const image of frame.images) {
      const existing = cameras.get(image.name);
      if (existing && (existing.width !== image.width || existing.height !== image.height)) {
        throw new TeleoperationReviewError(
          `Camera '${image.name}' changes dimensions in the episode.`,
          422,
        );
      }
      const video = videos[image.name];
      if (!video) {
        throw new TeleoperationReviewError(
          `Camera '${image.name}' has no episode video. Record the episode again.`,
          422,
        );
      }
      cameras.set(image.name, {
        ...image,
        video: { fps: video.fps, frameCount: video.frameCount },
      });
    }
  }
  const firstTask = frames[0]?.task;
  const reviewEpisode = {
    ...episode,
    ...(firstTask ? { task: firstTask } : {}),
  };
  return {
    review: {
      episode: reviewEpisode,
      frames,
      cameras: [...cameras.values()].sort((left, right) => left.name.localeCompare(right.name)),
    },
    videos,
  };
}

function safeRelativePath(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const normalized = value.replaceAll('\\', '/');
  const parts = normalized.split('/').filter(Boolean);
  if (normalized.startsWith('/') || parts.some((part) => part === '..')) return null;
  return parts.join('/');
}

export async function getTeleoperationEpisode(
  collectionDirectory: string,
  episode: TeleoperationEpisodeSummaryV1,
): Promise<TeleoperationEpisodeReviewV1> {
  const { review } = await readEpisodeMetadata(collectionDirectory, episode);
  return review;
}

/** Locate one camera's episode video for streaming with byte ranges. */
export async function getTeleoperationVideo(
  collectionDirectory: string,
  episode: TeleoperationEpisodeSummaryV1,
  cameraName: string,
): Promise<TeleoperationVideoFile> {
  const { videos } = await readEpisodeMetadata(collectionDirectory, episode);
  const video = videos[cameraName];
  if (!video) throw new TeleoperationReviewError('Camera video not found.', 404);
  const videoPath = path.join(
    episodeDirectory(collectionDirectory, episode.episodeIndex),
    video.path,
  );
  try {
    const file = await stat(videoPath);
    if (!file.isFile()) throw new TeleoperationReviewError('Camera video not found.', 404);
    return { path: videoPath, size: file.size, contentType: 'video/mp4' };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new TeleoperationReviewError('Camera video not found.', 404);
    }
    throw error;
  }
}
