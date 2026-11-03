// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** The Geti Image Classifier worker's API: pure functions of the instance's address. */

import { fetchJson, postJson } from '@/lib/browser/fetch-json'
import { jobFailure, type JobDefinition } from '@/services/common/jobs/job-run'

export const SERVICE_NAME = 'Geti Image Classifier'

/** Where the Geti server is and how to reach it. */
export interface GetiConnection {
  host: string
  token: string
  /** Check the server's TLS certificate; off by default, as on-prem Geti is usually self-signed. */
  verifyTls: boolean
}

/** The connection as the worker's request bodies spell it. */
function connectionBody({ host, token, verifyTls }: GetiConnection) {
  return { host: host.trim(), token: token.trim(), verify_ssl: verifyTls }
}

/** An image the worker keeps from a classification (original or masked). */
export function workerImageUrl(apiBase: string, imageId: string): string {
  return `${apiBase}/image/${imageId}`
}

export interface GetiHealth {
  status: string
  pipeline_ready: boolean

  cls_configured: boolean
  cls_model_loaded: boolean
  cls_project_name: string | null
  cls_project_id: string | null
  cls_allowed_labels: string[]
  cls_device: string
  cls_model_id: string | null
  cls_model_name: string | null
  cls_model_version: number | null
  cls_model_score: number | null

  seg_configured: boolean
  seg_model_loaded: boolean
  seg_project_name: string | null
  seg_project_id: string | null
  seg_device: string
  seg_model_id: string | null
  seg_model_name: string | null
  seg_model_version: number | null
  seg_model_score: number | null

  platform: string
  auto_sync_enabled: boolean
  auto_sync_interval_seconds: number
}

export const fetchHealth = (apiBase: string) =>
  fetchJson<GetiHealth>(`${apiBase}/healthcheck`, {
    errorMessage: 'Failed to load health status',
  })

/** Turns the background model sync on or off; answers its new state. */
export const toggleAutoSync = (apiBase: string, enabled: boolean) =>
  postJson<{ enabled: boolean; message: string }>(
    `${apiBase}/auto-sync/toggle`,
    { enabled },
    { errorMessage: 'Toggle failed' },
  )

export interface AvailableDevice {
  name: string
  full_name: string
  type: string
  supported: boolean
}

export const fetchDevices = (apiBase: string) =>
  fetchJson<{
    status: string
    current_device: string
    available_devices: AvailableDevice[]
    supported_devices: string[]
  }>(`${apiBase}/devices`)

export interface GetiProject {
  id: string
  name: string
  labels: string[]
  creation_time: string | null
  score: number | null
}

export interface GetiModel {
  id: string
  name: string
  version: number | null
  score: number | null
  is_active: boolean
  creation_date: string | null
  precision: string[]
  size: number | null
  lifecycle_stage: string
}

export const fetchProjects = (apiBase: string, connection: GetiConnection) =>
  postJson<{ status: string; projects: GetiProject[]; total: number }>(
    `${apiBase}/projects`,
    connectionBody(connection),
    { errorMessage: 'Failed to fetch projects' },
  )

export const fetchModels = (
  apiBase: string,
  connection: GetiConnection,
  projectId: string,
) =>
  postJson<{ status: string; models: GetiModel[]; total: number }>(
    `${apiBase}/models`,
    {
      ...connectionBody(connection),
      project_id: projectId,
      project_name: null,
    },
    { errorMessage: 'Failed to fetch models' },
  )

/** Which model a setup deploys: segmentation or classification. */
export type DeployPhase = 'seg' | 'cls'

export interface SetupRequest {
  connection: GetiConnection
  phase: DeployPhase
  projectId: string
  /** A specific model version; `null` for the project's latest active one. */
  modelId: string | null
  device: string
}

export interface SetupResult {
  status: string
  project_id: string
  project_name: string
  labels: string[]
  model_name: string
  model_version: number | null
  model_score: number | null
  device: string
  requested_device: string
  device_confirmed: boolean
  message: string
}

/** Where a setup job is, in the order the worker goes through them. */
export type SetupStage =
  | 'queued'
  | 'connecting'
  | 'preparing'
  | 'downloading'
  | 'extracting'
  | 'compiling'
  | 'done'
  | 'error'

/** A setup job's status (`core/setup_jobs.py` on the worker). */
export interface SetupJob {
  job_id: string
  setup_type: DeployPhase
  status: 'running' | 'done' | 'error'
  stage: SetupStage
  message: string
  bytes_downloaded: number | null
  bytes_total: number | null
  result: SetupResult | null
  error: string | null
  error_status: number | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

/**
 * Deploys a model as a worker job with no time limit: building, downloading and compiling can take
 * minutes. Asking for the same setup while it runs joins the running job.
 */
export function setupJob(
  apiBase: string,
): JobDefinition<SetupRequest, SetupJob, SetupResult> {
  return {
    submit: async (request, signal) => {
      // A failed setup can come back as JSON (`detail`/`error`) or as a
      // plain-text proxy error; fetchJson surfaces whichever it carries.
      const started = await postJson<SetupJob>(
        `${apiBase}/setup-${request.phase}/jobs`,
        {
          ...connectionBody(request.connection),
          project_id: request.projectId,
          project_name: null,
          model_id: request.modelId,
          device: request.device,
        },
        { signal, errorMessage: 'Setup failed' },
      )
      return started.job_id
    },
    jobUrl: (jobId) => `${apiBase}/setup-jobs/${encodeURIComponent(jobId)}`,
    isQueued: (job) => job.stage === 'queued',
    followErrorMessage: 'Lost track of the setup',
    toResult: (job) => {
      if (job.status !== 'done' || !job.result) {
        throw jobFailure(job, 'Setup failed')
      }
      return job.result
    },
  }
}

export interface LabelScore {
  label: string
  /** Percent, 0–100. */
  confidence: number
}

/** The segmented region the classifier was shown. */
export interface SegmentationMeta {
  shape_type: string
  box: { x1: number; y1: number; x2: number; y2: number }
  area_px: number
  labels: LabelScore[]
  /** Objects the mask combines; absent from older workers, meaning one. */
  num_objects?: number
}

export interface ClassifyResponse {
  status: string
  image_id: string
  cropped_image_id: string
  predicted_label: string
  confidence: number
  all_predictions: LabelScore[]
  segmentation: SegmentationMeta
  cls_model_id: string | null
  cls_model_name: string
  cls_model_version: number | null
  cls_model_score: number | null
  cls_device: string
  seg_model_id: string | null
  seg_model_name: string
  seg_model_version: number | null
  seg_device: string
}

export function classifyImage(
  apiBase: string,
  file: File,
): Promise<ClassifyResponse> {
  const formData = new FormData()
  formData.append('file', file)
  return fetchJson(`${apiBase}/classify`, {
    method: 'POST',
    body: formData,
    errorMessage: 'Classification failed',
  })
}

export interface FeedbackRequest {
  connection: GetiConnection
  imageId: string
  labelName: string
  isCorrect: boolean
}

/** Uploads the masked image to Geti with its label, for retraining. */
export const submitFeedback = (
  apiBase: string,
  { connection, imageId, labelName, isCorrect }: FeedbackRequest,
) =>
  postJson<{
    status: string
    action: string
    geti_image_id: string
    training_triggered: boolean
    training_tasks: string[]
  }>(
    `${apiBase}/feedback`,
    {
      ...connectionBody(connection),
      image_id: imageId,
      label_name: labelName,
      is_correct: isCorrect,
    },
    { errorMessage: 'Feedback submission failed' },
  )
