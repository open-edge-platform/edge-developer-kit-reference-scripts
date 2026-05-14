// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, type UseMutationOptions } from '@tanstack/react-query'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SegmentationMeta {
  shape_type: string
  box: {
    x1: number
    y1: number
    x2: number
    y2: number
  }
  area_px: number
  labels: { label: string; confidence: number }[]
}

export interface ClassifyResult {
  status: string

  // Image IDs
  image_id: string
  cropped_image_id: string

  // Classification
  predicted_label: string
  confidence: number
  all_predictions: { label: string; confidence: number }[]

  // Segmentation metadata
  segmentation: SegmentationMeta

  // Classification model info
  cls_model_id: string | null
  cls_model_name: string
  cls_model_version: number | null
  cls_model_score: number | null
  cls_device: string

  // Segmentation model info
  seg_model_id: string | null
  seg_model_name: string
  seg_model_version: number | null
  seg_device: string
}

// ── Image URL helpers ─────────────────────────────────────────────────────────

/**
 * Returns the URL to fetch the original image from the worker temp store.
 */
export function getOriginalImageUrl(imageId: string): string {
  return `/api/geti-classifier/image/${imageId}`
}

/**
 * Returns the URL to fetch the cropped image from the worker temp store.
 */
export function getCroppedImageUrl(croppedImageId: string): string {
  return `/api/geti-classifier/image/${croppedImageId}`
}

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function classifyImage(file: File): Promise<ClassifyResult> {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch('/api/geti-classifier/classify', {
    method: 'POST',
    body: formData,
  })

  const data = (await res.json()) as ClassifyResult & {
    detail?: string
    error?: string
  }

  if (!res.ok) {
    throw new Error(data.detail ?? data.error ?? 'Classification failed')
  }

  return data
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useClassify(
  options?: UseMutationOptions<ClassifyResult, Error, File>,
) {
  return useMutation<ClassifyResult, Error, File>({
    mutationFn: classifyImage,
    ...options,
  })
}
