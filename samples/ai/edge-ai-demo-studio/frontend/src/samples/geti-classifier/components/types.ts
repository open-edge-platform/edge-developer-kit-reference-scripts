// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// ── View routing ──────────────────────────────────────────────────────────────

export type AppView = 'upload' | 'result' | 'refine' | 'settings'

// ── Geti server credentials ───────────────────────────────────────────────────

export interface GetiConfig {
  host: string
  token: string
}

// ── Classification result ─────────────────────────────────────────────────────

export interface PredictionEntry {
  label: string
  confidence: number
}

export interface SegmentBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface SegmentationInfo {
  shape_type: string
  box: SegmentBox
  area_px: number
  labels: PredictionEntry[]
  num_objects?: number
}

export interface ClassificationResult {
  // Display ID (short hash shown in UI)
  id: string

  // Original uploaded image URL (served from worker temp)
  originalImageUrl: string

  // Masked image URL (served from worker temp)
  croppedImageUrl: string

  // Classification output
  predictedLabel: string
  confidenceScore: number
  allPredictions: PredictionEntry[]

  // Image IDs (used for feedback + image fetching)
  imageId: string
  croppedImageId: string

  // Segmentation metadata
  segmentation: SegmentationInfo

  // Model info
  clsModelName: string
  clsModelVersion: number | null
  segModelName: string
  segModelVersion: number | null

  // Devices
  clsDevice: string
  segDevice: string
}

// ── Device types (used in settings wizard) ────────────────────────────────────

export interface AvailableDevice {
  name: string
  full_name: string
  type: string
  supported: boolean
}

export interface DevicesResponse {
  status: string
  current_device: string
  available_devices: AvailableDevice[]
  supported_devices: string[]
}
