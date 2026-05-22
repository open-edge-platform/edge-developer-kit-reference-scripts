// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState, useCallback, useEffect } from 'react'
import Image from 'next/image'
import { FileImage, X, AlertCircle, Loader2, Sparkles } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useClassify, getOriginalImageUrl, getCroppedImageUrl } from '../hooks'
import type { ClassificationResult, AppView } from './types'

// ── Constants ─────────────────────────────────────────────────────────────────

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/bmp',
  'image/tiff',
  'image/webp',
])

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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

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

  // ── File validation ─────────────────────────────────────────────────────────
  const validateAndSetFile = useCallback(
    (file: File) => {
      setValidationError(null)
      classify.reset()

      if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        setValidationError(
          'Please select a valid image file (JPG, PNG, BMP, TIFF, WEBP)',
        )
        return
      }
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setValidationError(`File size must be less than ${MAX_FILE_SIZE_MB}MB`)
        return
      }

      setSelectedFile(file)
      setPreviewUrl(URL.createObjectURL(file))
    },
    [classify],
  )

  // ── Drag handlers ───────────────────────────────────────────────────────────
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) validateAndSetFile(file)
    },
    [validateAndSetFile],
  )

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) validateAndSetFile(file)
    },
    [validateAndSetFile],
  )

  // ── Clear ───────────────────────────────────────────────────────────────────
  const clearFile = useCallback(() => {
    setSelectedFile(null)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setValidationError(null)
    classify.reset()
  }, [previewUrl, classify])

  // ── Classify ────────────────────────────────────────────────────────────────
  const handleClassify = useCallback(() => {
    if (!selectedFile || !modelReady || classify.isPending) return
    classify.mutate(selectedFile)
  }, [selectedFile, modelReady, classify])

  // ── Derived ─────────────────────────────────────────────────────────────────
  const isDisabled = !modelReady || classify.isPending
  const displayError =
    validationError ?? (classify.isError ? classify.error.message : null)

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
        {!selectedFile ? (
          <div
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              'relative cursor-pointer rounded-lg border-2 border-dashed p-12 text-center transition-all duration-200',
              isDragging && 'border-primary bg-primary/5',
              !isDragging &&
                'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50',
              isDisabled && 'pointer-events-none opacity-50',
            )}
          >
            <input
              type="file"
              accept="image/jpeg,image/png,image/bmp,image/tiff,image/webp"
              onChange={handleFileInput}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              disabled={isDisabled}
            />
            <FileImage className="text-muted-foreground mx-auto mb-4 h-16 w-16" />
            <p className="mb-2 text-lg font-medium">Drop your image here</p>
            <p className="text-muted-foreground text-sm">
              or click to browse (JPG, PNG, BMP, TIFF, WEBP)
            </p>
            <p className="text-muted-foreground mt-2 text-xs">
              Maximum file size: {MAX_FILE_SIZE_MB}MB
            </p>
          </div>
        ) : (
          /* ── Selected file preview ──────────────────────────────────────── */
          <div className="space-y-3">
            <div className="bg-muted/30 overflow-hidden rounded-lg border">
              {previewUrl && (
                <Image
                  src={previewUrl}
                  alt="Image preview"
                  width={600}
                  height={256}
                  className="mx-auto object-contain"
                  style={{ maxHeight: '16rem', width: 'auto' }}
                  unoptimized
                />
              )}
            </div>

            <div className="flex items-center justify-between rounded-lg border-2 border-green-500 bg-green-50 p-4 dark:bg-green-950/20">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <FileImage className="h-6 w-6 flex-shrink-0 text-green-600 dark:text-green-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{selectedFile.name}</p>
                  <p className="text-muted-foreground text-sm">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              </div>
              {!classify.isPending && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={clearFile}
                  className="flex-shrink-0 hover:bg-red-100 dark:hover:bg-red-950"
                  type="button"
                >
                  <X className="h-5 w-5 text-red-600 dark:text-red-400" />
                </Button>
              )}
            </div>
          </div>
        )}

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
