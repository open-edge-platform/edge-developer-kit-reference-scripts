// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * The Synthetic Image Generation worker's API: projects, history, generation jobs and asset
 * deletion. Pure functions of the instance's address; the hooks wrap them.
 */

import { fetchJson, fetchOk } from '@/lib/browser/fetch-json'
import { dataUrlToFile } from '@/lib/browser/image-utils'
import { jobFailure, type JobDefinition } from '@/services/common/jobs/job-run'

export const SERVICE_NAME = 'Synthetic Image Generation'

export enum GenerationType {
  GOOD_DATASET = 'good_dataset',
  MISSING_COMPONENTS = 'missing_components',
  CUSTOM = 'custom',
}

/** What the worker calls each generation type. */
const BACKEND_TYPE: Record<GenerationType, string> = {
  [GenerationType.GOOD_DATASET]: 'SYNTHETIC',
  [GenerationType.MISSING_COMPONENTS]: 'MISSING_COMPONENT',
  [GenerationType.CUSTOM]: 'CUSTOM',
}

const SAFE_PATH_PATTERN = /^[a-zA-Z0-9_\-/]+\.(png|jpg|jpeg)$/

/** A file name under the worker's outputs folder that is safe to put in a URL. */
function isSafeImagePath(path: string): boolean {
  return Boolean(path) && SAFE_PATH_PATTERN.test(path) && !path.includes('..')
}

function validateImagePath(path: string): string {
  if (!isSafeImagePath(path)) {
    throw new Error('Invalid image path received from server')
  }
  return path
}

/** Same-origin path of a generated file under the worker's outputs folder. */
function outputUrl(apiBase: string, filename: string): string {
  return `${apiBase}/outputs/${filename}`
}

/** The asset's path under the outputs folder (`<project>/<TYPE>/<file>`), as the delete endpoint takes it. */
export function assetPath(url: string): string {
  return url.split('/').slice(-3).join('/')
}

/** Names the export and delete endpoints accept (and so the UI offers). */
export function isValidProjectName(name: string): boolean {
  return /^[a-zA-Z0-9_\-\s]+$/.test(name)
}

function validateProjectName(name: string): void {
  if (!isValidProjectName(name)) {
    throw new Error('Invalid project name: must be alphanumeric')
  }
}

/**
 * A generation job's status, as `GET /image-gen/job/{id}/events` sends it.
 * Jobs run one at a time on the worker, in the order they came.
 */
export interface SyntheticJobStatus {
  /** `pending` comes from older workers without a queue, for both waiting and running. */
  status: 'queued' | 'pending' | 'running' | 'completed' | 'error' | 'cancelled'
  stage?:
    'queued' | 'preparing' | 'segmenting' | 'generating' | 'saving' | 'done'
  /** Denoising steps done, of `steps`. */
  step?: number
  steps?: number
  /** Overall share done, 0 to 1. */
  progress?: number
  /** Jobs ahead of this one while it is queued. */
  jobs_ahead?: number
  image?: string
  mask_image?: string
  error?: string
  /**
   * Set once the job was asked to stop: a running job keeps its status
   * until its next denoising step, then reports `cancelled`.
   */
  cancel_requested?: boolean
}

/** One image to generate. Images are `data:` URLs, as the pickers read them. */
export interface GenerationRequest {
  baseImage: string
  referenceImage?: string
  type: GenerationType
  customPrompt?: string
  customType?: string
  projectName: string
}

/** A finished generation: the image, and its mask for missing components. */
export interface GeneratedAsset {
  imageUrl: string
  maskUrl?: string
}

async function submitGeneration(
  apiBase: string,
  request: GenerationRequest,
  signal: AbortSignal,
): Promise<string> {
  const formData = new FormData()
  formData.append('file', dataUrlToFile(request.baseImage, 'image.png'))
  formData.append('generation_type', BACKEND_TYPE[request.type])
  if (request.customPrompt) {
    formData.append('custom_prompt', request.customPrompt)
  }
  if (request.customType) formData.append('custom_type', request.customType)
  formData.append('project_name', request.projectName)
  if (request.referenceImage) {
    formData.append(
      'reference_file',
      dataUrlToFile(request.referenceImage, 'reference.png'),
    )
  }

  const submitted = await fetchJson<{ job_id?: string }>(
    `${apiBase}/image-gen/generate`,
    {
      method: 'POST',
      body: formData,
      signal,
      errorMessage: 'Image generation failed',
    },
  )
  if (!submitted.job_id) throw new Error('No job ID returned from API')
  return submitted.job_id
}

/**
 * Generating one image as a worker job: a queued one is dropped by a
 * cancel, a running one stops at its next denoising step without saving.
 */
export function generationJob(
  apiBase: string,
): JobDefinition<GenerationRequest, SyntheticJobStatus, GeneratedAsset> {
  return {
    submit: (request, signal) => submitGeneration(apiBase, request, signal),
    jobUrl: (jobId) => `${apiBase}/image-gen/job/${encodeURIComponent(jobId)}`,
    followErrorMessage: 'Failed to check job status',
    toResult: (status) => {
      if (status.status === 'error') {
        throw jobFailure(status, 'Image generation failed')
      }
      if (!status.image) throw new Error('No image returned from job')
      const image = validateImagePath(String(status.image))
      const mask = status.mask_image
        ? validateImagePath(String(status.mask_image))
        : undefined
      return {
        imageUrl: outputUrl(apiBase, image),
        maskUrl: mask ? outputUrl(apiBase, mask) : undefined,
      }
    },
  }
}

/** URLs of every generated image the worker keeps, newest first. */
export async function fetchHistory(apiBase: string): Promise<string[]> {
  const data = await fetchJson<{ images: string[] }>(
    `${apiBase}/image-gen/history`,
    { errorMessage: 'Failed to fetch image history' },
  )
  return data.images
    .filter(isSafeImagePath)
    .map((filename) => outputUrl(apiBase, filename))
}

export async function fetchProjects(apiBase: string): Promise<string[]> {
  const data = await fetchJson<{ projects?: string[] }>(`${apiBase}/projects`, {
    errorMessage: 'Failed to fetch projects',
  })
  return data.projects ?? []
}

/** Creates a project; resolves with the name the worker gave it. */
export async function createProject(
  apiBase: string,
  name: string,
): Promise<string> {
  const formData = new FormData()
  formData.append('project_name', name)
  const data = await fetchJson<{ project_name: string }>(
    `${apiBase}/projects/create`,
    {
      method: 'POST',
      body: formData,
      errorMessage: 'Failed to create project',
    },
  )
  return data.project_name
}

export async function deleteProject(
  apiBase: string,
  name: string,
): Promise<void> {
  validateProjectName(name)
  await fetchOk(`${apiBase}/projects/delete/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    errorMessage: 'Failed to delete project',
  })
}

export async function exportProject(
  apiBase: string,
  name: string,
): Promise<Blob> {
  validateProjectName(name)
  const res = await fetchOk(
    `${apiBase}/projects/export/${encodeURIComponent(name)}`,
    { errorMessage: 'Failed to export project' },
  )
  return res.blob()
}

/** Deletes one generated image (`<project>/<TYPE>/<file>`). */
export async function deleteAsset(
  apiBase: string,
  path: string,
): Promise<void> {
  await fetchJson<void>(
    `${apiBase}/image-gen/delete/${encodeURIComponent(path)}`,
    { method: 'DELETE', errorMessage: 'Failed to delete asset' },
  )
}
