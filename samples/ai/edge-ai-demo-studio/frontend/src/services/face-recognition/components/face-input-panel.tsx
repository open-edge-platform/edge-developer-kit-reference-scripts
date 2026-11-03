// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ScanFace } from 'lucide-react'
import { ImageSourcePanel } from '@/components/common/image-source-panel'
import type { useImageSource } from '@/hooks/use-image-source'
import type { RecognizedFace } from '../hooks'
import { FaceImageOverlay } from './face-image-overlay'

interface FaceInputPanelProps {
  /** The picked probe image and the webcam (`useImageSource`). */
  image: ReturnType<typeof useImageSource>
  faces: RecognizedFace[]
  onRun: () => void
  isRunning: boolean
}

/** Probe-image panel: upload or webcam capture, then run recognition. */
export function FaceInputPanel({
  image,
  faces,
  onRun,
  isRunning,
}: FaceInputPanelProps) {
  return (
    <ImageSourcePanel
      inputMode={image.inputMode}
      onInputModeChange={image.setInputMode}
      source={image.source}
      onSource={image.setSource}
      webcam={image.webcam}
      onRun={onRun}
      isRunning={isRunning}
      renderOverlay={(s) => (
        <FaceImageOverlay
          imageUrl={s.url}
          naturalWidth={s.naturalWidth}
          naturalHeight={s.naturalHeight}
          faces={faces}
        />
      )}
      dropZoneLabel="Drop an image with faces to identify"
      webcamDescription="Connect your webcam, then capture a frame to identify faces."
      captureFilenamePrefix="face-capture"
      runIcon={ScanFace}
      runLabel="Recognize Faces"
      runningLabel="Recognizing…"
      testIdPrefix="face"
    />
  )
}
