// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import { WebcamStream } from '@/components/common/webcam-stream'
import { useWebcamStream } from '@/hooks/use-webcam-stream'
import { dataUrlToFile } from '@/lib/browser/image-utils'
import { VlmRequiredNotice } from '@/samples/common/components/vlm-required-notice'
import { FeatureContexts } from '@/samples/common/feature-providers/feature-contexts'
import { useSampleChatFeatures } from '@/samples/common/feature-providers/use-sample-chat-features'
import { useTextGenerationParams } from '@/samples/common/hooks'
import { useSampleWorkspace } from '@/samples/common/sample-workspace'
import { SampleParamsSlot } from '@/samples/common/sample-params-slot'
import { useTextGenChat } from '@/services/text-generation/hooks/use-chat'
import type { Sample } from '../types'
import { ChatPanel } from './components/chat-panel'

/** Fill the composer; the user still sends explicitly. */
const EXAMPLE_QUESTIONS = [
  'What do you see in this frame?',
  'Describe the objects in view and where they are.',
  'Read any text that is visible in the picture.',
]

export function WebcamVlmDemo({ sample }: { sample: Sample }) {
  const textGen = useTextGenerationParams()
  const workspace = useSampleWorkspace()
  const suspended = workspace.suspended
  const features = useSampleChatFeatures(sample)

  const webcam = useWebcamStream()
  const webcamReady = webcam.isReady

  const chat = useTextGenChat({
    textGenValues: textGen.values,
    requestParams: textGen.requestParams,
    extraBody: features.extraBody,
  })
  // A frame captured ahead, shown in the composer until it is sent.
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null)

  // The composer's frame goes with the question, else one is captured now. Retry reuses the frame
  // (it is part of the message).
  const handleSend = () => {
    if (suspended) return
    const frame =
      capturedPreview ?? (webcamReady ? webcam.captureImage() : null)
    const sent = chat.handleSend({
      files: frame ? [dataUrlToFile(frame, 'webcam-capture.png')] : undefined,
    })
    if (sent) setCapturedPreview(null)
  }

  const handleReset = () => {
    chat.handleReset()
    setCapturedPreview(null)
  }

  const placeholder = suspended
    ? `Waiting for ${workspace.offlineRequired.join(', ')}…`
    : webcamReady
      ? 'Ask about what you see…'
      : 'Start the camera to ask about a frame…'
  const emptyStateText = suspended
    ? 'Your conversation is kept. Sending resumes once Text Generation is back.'
    : webcamReady
      ? 'Capture a frame and ask a question about it.'
      : 'Start the camera, capture a frame, then ask about it.'

  return (
    <div className="space-y-4">
      <VlmRequiredNotice>
        The selected Text Generation model may not accept images. Choose a
        vision language model (VLM) under Services to ask about frames.
      </VlmRequiredNotice>

      {features.renderProviders(chat.setInput)}

      <SampleParamsSlot groups={[textGen.group, ...features.groups]} />

      <FeatureContexts exports={features.exports}>
        {/* A container query, not a viewport breakpoint, so a short wide window goes side by side too. */}
        <div className="@container">
          <div className="grid grid-cols-1 items-stretch gap-4 @2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @2xl:gap-6">
            <WebcamStream
              videoRef={webcam.videoRef}
              isReady={webcamReady}
              error={webcam.error}
              startCamera={webcam.startCamera}
              stopCamera={webcam.stopCamera}
              devices={webcam.devices}
              selectedDeviceId={webcam.selectedDeviceId}
              listDevices={webcam.listDevices}
              title="Camera"
              description="Frames from this preview go with your questions."
              previewClassName="min-h-[160px] max-h-[min(55vh,420px)]"
            />
            <ChatPanel
              chat={chat}
              onSend={handleSend}
              onReset={handleReset}
              disabled={!webcamReady || suspended}
              captureImage={webcam.captureImage}
              webcamReady={webcamReady}
              capturedPreview={capturedPreview}
              onCapturedPreviewChange={setCapturedPreview}
              placeholder={placeholder}
              emptyStateText={emptyStateText}
              examplePrompts={
                webcamReady && !suspended ? EXAMPLE_QUESTIONS : undefined
              }
              sttOnline={features.sttOnline}
              ttsOnline={features.ttsOnline}
            />
          </div>
        </div>
      </FeatureContexts>
    </div>
  )
}
