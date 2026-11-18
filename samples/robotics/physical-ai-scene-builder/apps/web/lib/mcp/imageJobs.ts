// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'node:crypto';

import { imageTo3dImageError, type ImageTo3dPipelineType } from '@/lib/scenes/imageTo3dApi';

import { isEditorConnected, onEditorDisconnect } from './bridge';

const MAX_SHARED_IMAGES = 8;
const MAX_JOB_LOG_LINES = 20;
const MAX_JOBS = 20;

export type SharedImageSource = 'editor' | 'agent';
interface SharedImage {
  id: string;
  file: File;
  source: SharedImageSource;
  sharedAt: string;
}
type JobStatus = 'running' | 'succeeded' | 'failed';
interface ImageJob {
  id: string;
  requestId: string;
  imageId: string;
  imageName: string;
  pipelineType: ImageTo3dPipelineType;
  status: JobStatus;
  stage: string;
  logs: string[];
  libraryAssetId: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  controller: AbortController;
}
interface ImageSession {
  images: Map<string, SharedImage>;
  jobs: Map<string, ImageJob>;
}

const globalJobs = globalThis as typeof globalThis & {
  sceneMcpImageSessions?: Map<string, ImageSession>;
};
const imageSessions = (globalJobs.sceneMcpImageSessions ??= new Map<string, ImageSession>());

onEditorDisconnect((editorToken) => {
  const session = imageSessions.get(editorToken);
  for (const job of session?.jobs.values() ?? []) job.controller.abort();
  imageSessions.delete(editorToken);
});

function sessionFor(editorToken: string): ImageSession {
  if (!isEditorConnected(editorToken)) {
    throw new Error('MCP connection expired. Disable and enable MCP again.');
  }
  let session = imageSessions.get(editorToken);
  if (!session) {
    session = { images: new Map(), jobs: new Map() };
    imageSessions.set(editorToken, session);
  }
  return session;
}

export type SharedImageSummary = ReturnType<typeof imageSummary>;
function imageSummary(image: SharedImage) {
  return {
    id: image.id,
    name: image.file.name,
    type: image.file.type,
    sizeBytes: image.file.size,
    source: image.source,
    sharedAt: image.sharedAt,
  };
}

function jobSummary({ controller: _controller, requestId: _requestId, ...job }: ImageJob) {
  return job;
}
export type ImageJobSummary = ReturnType<typeof jobSummary>;

/** Validates and keeps an image for this MCP connection only; it is never written to disk. */
export function shareImage(editorToken: string, file: File, source: SharedImageSource) {
  const invalid = imageTo3dImageError(file);
  if (invalid) throw new Error(invalid);
  const session = sessionFor(editorToken);
  if (session.images.size >= MAX_SHARED_IMAGES) {
    throw new Error(`Remove a shared image first; at most ${MAX_SHARED_IMAGES} can be shared.`);
  }
  const image: SharedImage = {
    id: randomUUID(),
    file,
    source,
    sharedAt: new Date().toISOString(),
  };
  session.images.set(image.id, image);
  return imageSummary(image);
}

export function removeImage(editorToken: string, imageId: string) {
  sessionFor(editorToken).images.delete(imageId);
}

export function listImages(editorToken: string) {
  return [...(imageSessions.get(editorToken)?.images.values() ?? [])].map(imageSummary);
}

export function listImageJobs(editorToken: string): ImageJobSummary[] {
  return [...(imageSessions.get(editorToken)?.jobs.values() ?? [])].map(jobSummary);
}

export function getImageJob(editorToken: string, jobId: string): ImageJobSummary {
  const job = imageSessions.get(editorToken)?.jobs.get(jobId);
  if (!job) throw new Error('Unknown image-to-3D job. Start one with start_image_to_3d.');
  return jobSummary(job);
}

/**
 * Starts generation in the background and returns at once; agents poll get_image_to_3d_job.
 * TRELLIS.2 runs one generation at a time, so a second running job anywhere is rejected.
 */
export async function startImageJob(
  editorToken: string,
  input: { requestId: string; imageId: string; pipelineType: ImageTo3dPipelineType },
): Promise<ImageJobSummary> {
  const session = sessionFor(editorToken);
  const existing = [...session.jobs.values()].find((job) => job.requestId === input.requestId);
  if (existing) {
    if (existing.imageId !== input.imageId || existing.pipelineType !== input.pipelineType) {
      throw new Error('requestId was already used for a different command.');
    }
    return jobSummary(existing);
  }
  const image = session.images.get(input.imageId);
  if (!image) throw new Error('Unknown imageId. Call list_images for the shared images.');
  const [{ refreshTrellisServiceState }, { runImageTo3d, trellisTimeoutMs }] = await Promise.all([
    import('@/lib/process/trellisService'),
    import('@/lib/process/imageTo3dPipeline'),
  ]);
  if ((await refreshTrellisServiceState()).status !== 'running') {
    throw new Error(
      'The image-to-3D service is not running. Ask the user to start it in Build > Assets > Create object > Image to 3D model.',
    );
  }
  const timeoutMs = trellisTimeoutMs();
  // Checked after the awaits above so two concurrent starts cannot both pass.
  for (const other of imageSessions.values()) {
    if ([...other.jobs.values()].some((job) => job.status === 'running')) {
      throw new Error('TRELLIS.2 is already generating an object. Wait for that job to finish.');
    }
  }
  if (session.jobs.size >= MAX_JOBS) {
    const finished = [...session.jobs.values()].find((job) => job.status !== 'running');
    if (finished) session.jobs.delete(finished.id);
  }
  const job: ImageJob = {
    id: randomUUID(),
    requestId: input.requestId,
    imageId: image.id,
    imageName: image.file.name,
    pipelineType: input.pipelineType,
    status: 'running',
    stage: 'Starting…',
    logs: [],
    libraryAssetId: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    controller: new AbortController(),
  };
  session.jobs.set(job.id, job);
  const finish = (status: JobStatus, error: string | null) => {
    job.status = status;
    job.error = error;
    job.finishedAt = new Date().toISOString();
  };
  runImageTo3d({
    image: image.file,
    pipelineType: input.pipelineType,
    timeoutMs,
    signal: job.controller.signal,
    send: (event) => {
      if (event.type === 'stage') job.stage = event.label;
      else job.logs = [...job.logs, event.line].slice(-MAX_JOB_LOG_LINES);
    },
  }).then(
    (result) => {
      job.libraryAssetId = result.libraryAssetId;
      if (result.libraryAssetId === null) {
        finish('failed', 'The object was generated but could not be saved to the asset library.');
      } else finish('succeeded', null);
    },
    (error: unknown) =>
      finish(
        'failed',
        job.controller.signal.aborted
          ? 'Generation was cancelled because the editor disconnected.'
          : error instanceof Error
            ? error.message
            : 'The image could not be converted.',
      ),
  );
  return jobSummary(job);
}
