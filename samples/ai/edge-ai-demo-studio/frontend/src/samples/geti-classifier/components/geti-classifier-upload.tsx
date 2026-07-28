// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState, useCallback, useEffect } from 'react'
import { AlertCircle, Loader2, Sparkles } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ImageDropZone } from '@/components/common/image-drop-zone'
import { useClassify, getOriginalImageUrl, getCroppedImageUrl } from '../hooks'
import type { ClassificationResult, AppView } from './types'

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCEPTED_IMAGE_TYPES =
  'image/jpeg,image/png,image/bmp,image/tiff,image/webp'
const MAX_FILE_SIZE_MB = 10

// ── Props ─────────────────────────────────────────────────────────────────────

interface GetiClassifierUploadProps {
  modelReady: boolean
  setCurrentView: (view: AppView) => void
  setClassificationResult: (result: ClassificationResult) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GetiClassifierUpload({
  modelReady,
  setCurrentView,
  setClassificationResult,
}: GetiClassifierUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  // ── Classify hook ───────────────────────────────────────────────────────────
  const classify = useClassify({
    onSuccess: (data) => {
      setClassificationResult({
        // Short display ID
        id: `#${data.image_id.slice(0, 8).toUpperCase()}`,

        // Images served from worker temp via /image/{id}
        originalImageUrl: getOriginalImageUrl(data.image_id),
        croppedImageUrl: getCroppedImageUrl(data.cropped_image_id),

        // Classification
        predictedLabel: data.predicted_label,
        confidenceScore: data.confidence,
        allPredictions: data.all_predictions,

        // IDs for feedback
        imageId: data.image_id,
        croppedImageId: data.cropped_image_id,

        // Segmentation metadata
        segmentation: data.segmentation,

        // Model info
        clsModelName: data.cls_model_name,
        clsModelVersion: data.cls_model_version,
        segModelName: data.seg_model_name,
        segModelVersion: data.seg_model_version,

        // Devices
        clsDevice: data.cls_device,
        segDevice: data.seg_device,
      })
    },
  })

  // ── Navigate to result on success ───────────────────────────────────────────
  useEffect(() => {
    if (classify.isSuccess) {
      setCurrentView('result')
    }
  }, [classify.isSuccess, setCurrentView])

  // ── File selection ──────────────────────────────────────────────────────────
  const handleFileChange = useCallback(
    (file: File | null) => {
      classify.reset()
      setSelectedFile(file)
    },
    [classify],
  )

  // ── Classify ────────────────────────────────────────────────────────────────
  const handleClassify = useCallback(() => {
    if (!selectedFile || !modelReady || classify.isPending) return
    classify.mutate(selectedFile)
  }, [selectedFile, modelReady, classify])

  // ── Derived ─────────────────────────────────────────────────────────────────
  const isDisabled = !modelReady || classify.isPending
  const displayError = classify.isError ? classify.error.message : null

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload Image</CardTitle>
        <CardDescription>
          Upload an image — it will be segmented, masked, then classified in one
          step.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── Pipeline not ready warning ──────────────────────────────────── */}
        {!modelReady && (
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20">
            <p className="flex items-center gap-2 text-sm text-yellow-800 dark:text-yellow-200">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              Both segmentation and classification models must be configured
              before classifying. Go to{' '}
              <button
                className="font-medium underline"
                onClick={() => setCurrentView('settings')}
              >
                Settings
              </button>{' '}
              to set them up.
            </p>
          </div>
        )}

        {/* ── Drop zone ───────────────────────────────────────────────────── */}
        <ImageDropZone
          file={selectedFile}
          onFileChange={handleFileChange}
          accept={ACCEPTED_IMAGE_TYPES}
          maxSizeMb={MAX_FILE_SIZE_MB}
          disabled={isDisabled}
        />

        {/* ── Pipeline steps indicator ─────────────────────────────────────── */}
        {classify.isPending && (
          <div className="bg-muted/30 space-y-2 rounded-lg border p-4">
            <p className="text-sm font-medium">Processing pipeline...</p>
            <div className="space-y-1.5 text-sm">
              <div className="text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                Step 1 — Segmenting image...
              </div>
              <div className="text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-500" />
                Step 2 — Applying segmentation mask...
              </div>
              <div className="text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-green-500" />
                Step 3 — Classifying masked region...
              </div>
            </div>
          </div>
        )}

        {/* ── Error ───────────────────────────────────────────────────────── */}
        {displayError && (
          <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-lg border p-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {displayError}
            </p>
          </div>
        )}

        {/* ── Classify button ──────────────────────────────────────────────── */}
        <Button
          onClick={handleClassify}
          disabled={!selectedFile || isDisabled}
          className="w-full"
          size="lg"
          type="button"
        >
          {classify.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Running pipeline...
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              Segment &amp; Classify
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  )
}
