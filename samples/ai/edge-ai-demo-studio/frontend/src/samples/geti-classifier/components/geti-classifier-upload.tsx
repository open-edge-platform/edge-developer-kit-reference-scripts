// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { ImageDropZone } from '@/components/common/image-drop-zone'
import { InlineNotice } from '@/components/common/inline-notice'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useServiceApiBase } from '@/context/service-status-context'
import { useClassify } from '../hooks/use-geti-api'
import type { AppView, ClassificationResult } from '../lib/classification'
import { SettingsRequiredNotice } from './settings-required-notice'

interface GetiClassifierUploadProps {
  modelReady: boolean
  setCurrentView: (view: AppView) => void
  /** Called with a classification once it is in; the caller shows it. */
  onClassified: (result: ClassificationResult) => void
}

/** Picking an image and running the segment → mask → classify pipeline on it. */
export function GetiClassifierUpload({
  modelReady,
  setCurrentView,
  onClassified,
}: GetiClassifierUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const apiBase = useServiceApiBase('geti-classifier')
  const classify = useClassify(apiBase)

  const isDisabled = !modelReady || classify.isPending

  const handleFileChange = (file: File | null) => {
    classify.reset()
    setSelectedFile(file)
  }

  const handleClassify = () => {
    if (!selectedFile || isDisabled) return
    classify.mutate(selectedFile, { onSuccess: onClassified })
  }

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
        {!modelReady && (
          <SettingsRequiredNotice
            onOpenSettings={() => setCurrentView('settings')}
          >
            {(settingsLink) => (
              <>
                Both segmentation and classification models must be configured
                before classifying. Go to {settingsLink} to set them up.
              </>
            )}
          </SettingsRequiredNotice>
        )}

        <ImageDropZone
          file={selectedFile}
          onFileChange={handleFileChange}
          disabled={isDisabled}
        />

        {classify.isPending && (
          <p
            role="status"
            className="bg-muted/30 text-muted-foreground flex items-center gap-2 rounded-lg border p-4 text-sm"
          >
            <Loader className="text-primary h-4 w-4 animate-spin" aria-hidden />
            Segmenting the image, applying the mask, then classifying the masked
            region…
          </p>
        )}

        {classify.isError && (
          <InlineNotice tone="destructive" size="sm">
            {classify.error.message}
          </InlineNotice>
        )}

        <Button
          onClick={handleClassify}
          disabled={!selectedFile || isDisabled}
          aria-busy={classify.isPending || undefined}
          className="w-full"
          size="lg"
          type="button"
        >
          {classify.isPending ? (
            <>
              <Loader className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              Running pipeline...
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" aria-hidden />
              Segment &amp; Classify
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  )
}
