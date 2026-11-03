// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useGetService } from '@/context/service-status-context'

export interface TextGenModelSupport {
  /** The Text Generation model the sample uses takes images (a VLM). */
  isMultimodal: boolean
  /** Running but does not take images; an image-sending sample shows `VlmRequiredNotice`. */
  needsVlm: boolean
}

/** What the sample's Text Generation instance (the bound one, else the primary) can take. */
export function useTextGenModelSupport(): TextGenModelSupport {
  const service = useGetService('text-generation')
  const isMultimodal = service?.currentModelType === 'multimodal'
  return {
    isMultimodal,
    needsVlm: service?.status === 'online' && !isMultimodal,
  }
}
