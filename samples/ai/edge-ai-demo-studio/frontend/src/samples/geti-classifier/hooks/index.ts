// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// Re-export service hooks for use within this sample
export {
  useClassify,
  getOriginalImageUrl,
  getCroppedImageUrl,
  useFeedback,
  useProjects,
  useModels,
  useSetup,
  useAutoSync,
} from '@/services/geti-classifier/hooks'

export type {
  GetiHealthResponse,
  ClassifyResult,
  SegmentationMeta,
  FeedbackPayload,
  FeedbackResult,
  GetiProject,
  ProjectsPayload,
  ProjectsResult,
  GetiModel,
  ModelsPayload,
  ModelsResult,
  SetupPayload,
  SetupResult,
  AutoSyncResult,
} from '@/services/geti-classifier/hooks'

// Device hooks (local to this sample)
export { useAvailableDevices } from './use-device'
