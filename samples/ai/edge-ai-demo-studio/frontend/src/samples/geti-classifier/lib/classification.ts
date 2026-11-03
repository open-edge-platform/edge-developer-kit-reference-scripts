// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  type ClassifyResponse,
  type LabelScore,
  type SegmentationMeta,
  workerImageUrl,
} from './api'

/** A classification as the result and refine views show it. */
export interface ClassificationResult {
  /** Short id shown in the UI, e.g. `#1A2B3C4D`. */
  id: string
  /** The uploaded image, kept by the worker. */
  originalImageUrl: string
  /** The image with the segmentation mask applied: what was classified. */
  croppedImageUrl: string
  predictedLabel: string
  /** Percent, 0–100. */
  confidenceScore: number
  allPredictions: LabelScore[]
  /** Ids the feedback refers to. */
  imageId: string
  croppedImageId: string
  segmentation: SegmentationMeta
  clsModelName: string
  clsModelVersion: number | null
  segModelName: string
  segModelVersion: number | null
  clsDevice: string
  segDevice: string
}

/** The worker's answer to `POST /classify`, as the views use it. */
export function toClassificationResult(
  apiBase: string,
  data: ClassifyResponse,
): ClassificationResult {
  return {
    id: `#${data.image_id.slice(0, 8).toUpperCase()}`,
    originalImageUrl: workerImageUrl(apiBase, data.image_id),
    croppedImageUrl: workerImageUrl(apiBase, data.cropped_image_id),
    predictedLabel: data.predicted_label,
    confidenceScore: data.confidence,
    allPredictions: data.all_predictions,
    imageId: data.image_id,
    croppedImageId: data.cropped_image_id,
    segmentation: data.segmentation,
    clsModelName: data.cls_model_name,
    clsModelVersion: data.cls_model_version,
    segModelName: data.seg_model_name,
    segModelVersion: data.seg_model_version,
    clsDevice: data.cls_device,
    segDevice: data.seg_device,
  }
}

export type AppView = 'upload' | 'result' | 'refine' | 'settings'
