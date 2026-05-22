// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// Re-export all hooks from the service — samples should not define service-level API hooks.
export {
  GenerationType,
  useGetSyntheticImageHistory,
  useGetSyntheticImageProjects,
  useGenerateSyntheticImage,
  useDeleteSyntheticImageAsset,
  useCreateSyntheticImageProject,
  useDeleteSyntheticImageProject,
  useExportSyntheticImageProject,
} from '@/services/synthetic-image-generation/hooks'
