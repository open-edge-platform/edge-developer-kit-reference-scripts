// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { AlertTriangle } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useGetServices } from '@/context/service-status-context'
import {
  useMcpParams,
  useOptionalServiceGroup,
  useTextGenerationParams,
  useTtsParams,
} from '@/samples/common/hooks'
import type { Sample } from '../types'
import { ChatArea } from './components/chat-area'
import { WebcamStream } from './components/webcam-stream'
import { useWebcamStream } from './hooks/use-webcam-stream'
import { SampleParamsSlot } from '../common/sample-params-slot'

function dataUrlToFile(dataUrl: string, filename: string): File {
  const [header, base64] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/png'
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new File([bytes], filename, { type: mime })
}

export function WebcamVlmDemo({ sample }: { sample: Sample }) {
  const textGen = useTextGenerationParams()
  const tts = useTtsParams(sample.id)

  const stt = useOptionalServiceGroup({
    serviceId: 'speech-to-text',
    serviceLabel: 'Speech to Text',
    offlineMessage:
      'Enable STT for voice input. Start the service from the services page.',
  })

  const mcp = useMcpParams()

  const { 'text-generation': textGenService } = useGetServices([
    'text-generation',
  ])
  const isMultimodal = textGenService?.currentModelType === 'multimodal'

  const {
    devices,
    selectedDeviceId,
    videoRef,
    listDevices,
    startCamera,
    stopCamera,
    captureImage,
    isReady: webcamReady,
    error: webcamError,
  } = useWebcamStream()

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/services/text-generation/chat',
    }),
  })
  const isRunning = status === 'submitted' || status === 'streaming'

  const [input, setInput] = useState('')
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null)

  const handleSend = useCallback(() => {
    if (!input.trim() || isRunning) return

    let files: FileList | undefined
    if (capturedPreview) {
      const file = dataUrlToFile(capturedPreview, 'webcam-capture.png')
      const dt = new DataTransfer()
      dt.items.add(file)
      files = dt.files
    } else if (webcamReady) {
      // Auto-capture from webcam when no preview is set
      const dataUrl = captureImage()
      if (dataUrl) {
        const file = dataUrlToFile(dataUrl, 'webcam-capture.png')
        const dt = new DataTransfer()
        dt.items.add(file)
        files = dt.files
      }
    }

    sendMessage(
      {
        text: input,
        ...(files ? { files } : {}),
      },
      {
        body: {
          maxTokens: textGen.values.maxTokens,
          temperature: textGen.values.temperature,
          topK: textGen.values.topK,
          ...(textGen.values.systemPrompt.trim()
            ? { systemPrompt: textGen.values.systemPrompt.trim() }
            : {}),
          disableReasoning: textGen.values.disableReasoning,
        },
      },
    )
    setInput('')
    setCapturedPreview(null)
  }, [
    input,
    isRunning,
    capturedPreview,
    webcamReady,
    captureImage,
    sendMessage,
    textGen.values,
  ])

  const handleReset = useCallback(() => {
    setMessages([])
    setCapturedPreview(null)
  }, [setMessages])

  return (
    <div className="space-y-4">
      {/* VLM warning */}
      {textGenService?.status === 'online' && !isMultimodal && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-warning mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <h4 className="font-semibold text-amber-800 dark:text-amber-200">
                VLM Required
              </h4>
              <p className="text-sm text-amber-700 dark:text-amber-300">
                The text generation service may not support image processing.
                Please ensure a Visual Language Model (VLM) is configured.
              </p>
            </div>
          </div>
        </div>
      )}

      <SampleParamsSlot
        groups={[textGen.group, tts.group, stt.group, mcp.group]}
      />

      {/* Main layout: webcam + chat */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <WebcamStream
          videoRef={videoRef}
          isReady={webcamReady}
          error={webcamError}
          startCamera={startCamera}
          stopCamera={stopCamera}
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          listDevices={listDevices}
        />
        <ChatArea
          messages={messages}
          status={status}
          input={input}
          onInputChange={setInput}
          onSend={handleSend}
          onReset={handleReset}
          disabled={!webcamReady}
          captureImage={captureImage}
          webcamReady={webcamReady}
          capturedPreview={capturedPreview}
          onCapturedPreviewChange={setCapturedPreview}
          sttOnline={stt.enabled}
          ttsOnline={tts.online}
          ttsVoice={tts.values.voice}
          ttsSpeed={tts.values.speed}
        />
      </div>
    </div>
  )
}
