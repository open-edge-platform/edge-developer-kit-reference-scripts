// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { GenerationType, SyntheticJobStatus } from './api'

export interface GeneratedImage {
  /** Unique in the gallery: the URL for a history image, a local id for one being generated. */
  id: string
  /** Empty while the image is still being generated. */
  url: string
  type: GenerationType
  customTypeRaw?: string
  timestamp: number
  isLoading?: boolean
  project?: string
  maskUrl?: string
  /** The worker's latest status for an image still being generated. */
  job?: SyntheticJobStatus
  /** Set for an image whose generation failed: it stays until removed. */
  failure?: {
    error: string
    /** Its request is still known, so Retry can send it again. */
    canRetry: boolean
  }
}
