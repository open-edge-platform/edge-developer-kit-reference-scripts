// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Info } from 'lucide-react'
import { InlineNotice } from '@/components/common/inline-notice'
import { useImageSource } from '@/hooks/use-image-source'
import type { Service } from '@/services/types'
import { FaceGalleryPanel } from './components/face-gallery-panel'
import { FaceInputPanel } from './components/face-input-panel'
import { FaceResultsPanel } from './components/face-results-panel'
import { useGallery, useRecognize } from './hooks'

/** Step 1 enrolls people; step 2 recognizes a probe image's faces (unnamed without step 1). */
export function FaceRecognitionDemo({ service }: { service: Service }) {
  const recognize = useRecognize(service.apiBase)
  // Same query as the gallery panel: is anyone enrolled?
  const gallery = useGallery(service.apiBase)
  const galleryEmpty = gallery.data?.persons.length === 0
  // A new probe image (or none) drops the last result.
  const image = useImageSource({ onSourceChange: () => recognize.reset() })

  const run = () => {
    if (image.source) recognize.mutate(image.source.file)
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <FaceGalleryPanel apiBase={service.apiBase} />
        <section
          aria-labelledby="face-step-recognize"
          className="min-w-0 space-y-4"
        >
          <div className="space-y-1">
            <h3
              id="face-step-recognize"
              className="flex items-center gap-2 text-base font-semibold"
            >
              <span
                aria-hidden="true"
                className="bg-primary text-primary-foreground flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs"
              >
                2
              </span>
              <span>
                <span className="sr-only">Step 2: </span>
                Recognize faces
              </span>
            </h3>
            <p className="text-muted-foreground text-xs">
              Upload or capture a photo. Every face in it is found and compared
              with the people enrolled in step 1.
            </p>
          </div>
          {galleryEmpty && (
            <InlineNotice
              tone="info"
              size="sm"
              role="note"
              data-testid="face-gallery-empty-notice"
              icon={<Info aria-hidden="true" className="h-4 w-4 shrink-0" />}
            >
              No one is enrolled yet. Recognition still detects faces, but every
              face comes back as Unknown. Enroll people in step 1 to get names.
            </InlineNotice>
          )}
          <FaceInputPanel
            image={image}
            faces={recognize.data?.faces ?? []}
            onRun={run}
            isRunning={recognize.isPending}
          />
          <FaceResultsPanel
            result={recognize.data ?? null}
            isRunning={recognize.isPending}
            error={recognize.error}
          />
        </section>
      </div>
    </div>
  )
}
