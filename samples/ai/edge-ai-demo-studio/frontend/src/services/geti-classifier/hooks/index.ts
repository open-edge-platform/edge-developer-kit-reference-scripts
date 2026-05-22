// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export {
  useGetiHealth,
  isPipelineReady,
  isClsReady,
  isSegReady,
} from './use-health'
export type { GetiHealthResponse } from './use-health'

export {
  useClassify,
  getOriginalImageUrl,
  getCroppedImageUrl,
} from './use-classify'
export type { ClassifyResult, SegmentationMeta } from './use-classify'

export { useFeedback } from './use-feedback'
export type { FeedbackPayload, FeedbackResult } from './use-feedback'

export { useProjects } from './use-projects'
export type {
  GetiProject,
  ProjectsPayload,
  ProjectsResult,
} from './use-projects'

export { useModels } from './use-models'
export type { GetiModel, ModelsPayload, ModelsResult } from './use-models'

export { useSetup } from './use-setup'
export type { SetupPayload, SetupResult } from './use-setup'

export { useAutoSync } from './use-auto-sync'
export type { AutoSyncResult } from './use-auto-sync'
