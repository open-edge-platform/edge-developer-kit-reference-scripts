// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader, Mic, Square, Upload } from 'lucide-react'
import { useState } from 'react'
import { InlineNotice } from '@/components/common/inline-notice'
import { UploadButton } from '@/components/common/upload-button'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAudioVisualizer } from '@/hooks/use-audio-visualizer'
import { useElapsedMs } from '@/hooks/use-elapsed-ms'
import { useMediaRecorder } from '@/hooks/use-media-recorder'
import { formatClock } from '@/lib/browser/format'
import { DemoLayout } from '@/services/common/demo/components/demo-layout'
import { DemoParameterSidebar } from '@/services/common/demo/components/demo-parameter-sidebar'
import { demoStateKey } from '@/services/common/demo/demo-session'
import type { Service } from '@/services/types'
import { getEffectiveModel } from '@/types/service'
import { RecordControl } from './components/record-control'
import { TranscriptActions } from './components/transcript-actions'
import { TranscriptPanel } from './components/transcript-panel'
import { getSttCapabilities } from './config'
import { useLiveTranscription } from './hooks/use-live-transcription'
import { useSttParams } from './hooks/use-params'
import { useTranscribe } from './hooks/use-transcribe'
import { subtitleCues } from './lib/transcript-export'

type SttMode = 'batch' | 'live'

function isSttMode(value: string): value is SttMode {
  return value === 'batch' || value === 'live'
}

/** `1:05.3`: minutes, seconds and tenths. */
function formatRecordingTime(ms: number): string {
  return `${formatClock(ms / 1000)}.${Math.floor((ms % 1000) / 100)}`
}

export function SpeechToTextDemo({ service }: { service: Service }) {
  const capabilities = getSttCapabilities(service)
  const [mode, setMode] = useState<SttMode>('batch')
  const isBatchMode = mode === 'batch'
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(
    null,
  )
  // The uploaded file or recording the batch transcript is of; names its downloads.
  const [batchSource, setBatchSource] = useState<{
    label: string
    fileName: string
  } | null>(null)

  const live = useLiveTranscription(service, {
    backend: capabilities.backend,
  })
  // A live session keeps the language and voice detection it started with.
  const isLiveSessionOpen = live.isActive || live.isFlushing
  const { values: sttValues, params } = useSttParams({
    model: getEffectiveModel(service).name,
    autoLanguage: capabilities.autoLanguage,
    denoise: capabilities.denoise,
    live: !isBatchMode,
    locked: isLiveSessionOpen,
    sessionKey: demoStateKey(service, 'stt:params'),
  })
  const mediaRecorder = useMediaRecorder()
  const transcribe = useTranscribe(service.apiBase)
  const { levels } = useAudioVisualizer(
    isBatchMode ? recordingStream : live.stream,
  )
  const recordDuration = useElapsedMs(mediaRecorder.isRecording, {
    tickMs: 100,
  })

  // Blocks a second Record while the mic opens, which would leak a stream that is never stopped.
  const [isRecordStarting, setIsRecordStarting] = useState(false)

  const startRecording = async () => {
    setIsRecordStarting(true)
    try {
      const { stream } = await mediaRecorder.start()
      setRecordingStream(stream)
    } catch {
      // mediaRecorder.error already reflects the failure.
    } finally {
      setIsRecordStarting(false)
    }
  }

  const stopRecording = async () => {
    setRecordingStream(null)
    const length = formatClock(recordDuration / 1000)
    const blob = await mediaRecorder.stop()
    if (blob.size === 0) return
    setBatchSource({ label: `Recording · ${length}`, fileName: 'recording' })
    transcribe.mutate({
      file: blob,
      language: sttValues.language,
      useDenoise: sttValues.useDenoise,
    })
  }

  const handleFileUpload = (file: File) => {
    setBatchSource({ label: file.name, fileName: file.name })
    transcribe.mutate({
      file,
      language: sttValues.language,
      useDenoise: sttValues.useDenoise,
    })
  }

  const clearBatch = () => {
    transcribe.reset()
    setBatchSource(null)
  }

  const isProcessing = transcribe.isPending
  const isActive = isBatchMode ? mediaRecorder.isRecording : live.isActive
  const isBusy = isBatchMode
    ? isProcessing || isRecordStarting
    : live.isFlushing
  const canSwitchMode =
    !mediaRecorder.isRecording &&
    !isRecordStarting &&
    !isProcessing &&
    !isLiveSessionOpen

  const handleRecordToggle = () => {
    if (isBatchMode) {
      if (mediaRecorder.isRecording) stopRecording()
      else if (!isRecordStarting) startRecording()
    } else if (live.isActive) live.stop()
    else {
      live.start({
        language: sttValues.language,
        pauseSeconds: sttValues.pauseSeconds,
        vadSensitivity: sttValues.vadSensitivity,
      })
    }
  }

  const status = isBatchMode
    ? mediaRecorder.isRecording
      ? `Recording... ${formatRecordingTime(recordDuration)}`
      : isRecordStarting
        ? 'Starting...'
        : isProcessing
          ? 'Transcribing...'
          : 'Click to start recording'
    : live.isStarting
      ? 'Starting...'
      : live.isActive
        ? live.voice.speaking
          ? 'Speech detected'
          : live.voice.transcribing
            ? 'Transcribing...'
            : 'Listening...'
        : live.isFlushing
          ? 'Finishing...'
          : 'Click to start live transcription'

  // Screen reader announcement; unlike the visible status it doesn't tick with the clock.
  const announcement = isBatchMode
    ? mediaRecorder.isRecording
      ? 'Recording started'
      : isProcessing
        ? 'Recording stopped. Transcribing.'
        : transcribe.isSuccess
          ? 'Transcription ready'
          : ''
    : live.isStarting
      ? 'Starting live transcription'
      : live.isActive
        ? 'Listening'
        : live.isFlushing
          ? 'Stopping. Finishing the last words.'
          : live.transcripts.length > 0
            ? 'Live transcription stopped'
            : ''

  const liveText = live.transcripts.map((t) => t.text).join(' ')
  const batchText = transcribe.data?.text ?? ''
  const liveFinished = !live.isActive && !live.isFlushing

  return (
    <DemoLayout
      sidebar={
        <DemoParameterSidebar params={params}>
          {isBatchMode && (
            <p
              className="text-muted-foreground text-xs"
              data-testid="stt-live-settings-hint"
            >
              Pause length and speech sensitivity are on the Live tab: they tune
              its voice detection.
            </p>
          )}
          {isLiveSessionOpen && (
            <p
              className="text-muted-foreground text-xs"
              data-testid="stt-params-locked"
            >
              Locked while live transcription runs: stop it to change these,
              then Go Live again.
            </p>
          )}
        </DemoParameterSidebar>
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-foreground text-sm font-medium">Audio Input</h3>
            <Tabs
              value={mode}
              onValueChange={(value) => {
                if (!isSttMode(value)) return
                mediaRecorder.clearError()
                live.clearMicError()
                setMode(value)
              }}
            >
              <TabsList aria-label="Transcription mode">
                <TabsTrigger
                  value="batch"
                  disabled={!canSwitchMode}
                  data-testid="stt-mode-batch"
                >
                  Batch
                </TabsTrigger>
                <TabsTrigger
                  value="live"
                  disabled={!canSwitchMode}
                  data-testid="stt-mode-live"
                >
                  Live
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <p role="status" className="sr-only" data-testid="stt-announcement">
            {announcement}
          </p>
          <RecordControl
            active={isActive}
            busy={isBusy}
            capturing={mediaRecorder.isRecording || live.isActive}
            levels={levels}
            speech={
              !isBatchMode && live.isActive && !live.isStarting
                ? live.voice.speaking
                : undefined
            }
            status={status}
            micError={isBatchMode ? mediaRecorder.error : live.micError}
            onToggle={handleRecordToggle}
          />

          <div className="flex gap-2">
            <Button
              variant={isActive ? 'destructive' : 'outline'}
              className="flex-1 gap-2"
              onClick={handleRecordToggle}
              disabled={isBusy}
            >
              {isActive ? (
                <>
                  <Square aria-hidden className="h-4 w-4" />
                  {isBatchMode ? 'Stop Recording' : 'Stop'}
                </>
              ) : (
                <>
                  <Mic aria-hidden className="h-4 w-4" />
                  {isBatchMode ? 'Record' : 'Go Live'}
                </>
              )}
            </Button>
            {isBatchMode && (
              <UploadButton
                accept="audio/*"
                onFiles={(files) => handleFileUpload(files[0])}
                disabled={
                  mediaRecorder.isRecording || isRecordStarting || isProcessing
                }
                className="gap-2"
                inputTestId="stt-file-input"
              >
                <Upload aria-hidden className="h-4 w-4" />
                Upload
              </UploadButton>
            )}
          </div>
        </div>

        {isBatchMode ? (
          <TranscriptPanel
            badge={transcribe.isSuccess ? 'Completed' : undefined}
            hasText={Boolean(batchText)}
            source={
              (transcribe.isSuccess || isProcessing) && batchSource
                ? batchSource.label
                : undefined
            }
            actions={
              transcribe.isSuccess && (
                <TranscriptActions
                  text={batchText}
                  cues={subtitleCues(transcribe.data.segments)}
                  sourceName={batchSource?.fileName ?? 'transcript'}
                  onClear={clearBatch}
                  disabled={isProcessing || mediaRecorder.isRecording}
                />
              )
            }
            note={
              transcribe.isSuccess || transcribe.isError
                ? 'A new recording or upload replaces this result. Copy or download the transcript first to keep it.'
                : undefined
            }
          >
            {isProcessing && (
              <div className="text-muted-foreground flex items-center gap-2">
                <Loader aria-hidden className="h-4 w-4 animate-spin" />
                Transcribing audio...
              </div>
            )}
            {transcribe.isError && (
              <InlineNotice tone="destructive" size="sm">
                {transcribe.error.message}
              </InlineNotice>
            )}
            {transcribe.isSuccess && (
              <span data-testid="stt-result-text">
                {transcribe.data.text || 'No speech detected in the audio.'}
              </span>
            )}
            {transcribe.isIdle &&
              'Record or upload audio. Its transcript appears here.'}
          </TranscriptPanel>
        ) : (
          <TranscriptPanel
            badge={live.isActive && !live.isStarting ? 'Live' : undefined}
            hasText={liveText.length > 0}
            source={liveText ? 'Microphone · live' : undefined}
            actions={
              liveFinished &&
              liveText && (
                <TranscriptActions
                  text={live.transcripts.map((t) => t.text).join('\n')}
                  cues={subtitleCues(live.transcripts)}
                  sourceName="live-transcript"
                  onClear={live.clear}
                />
              )
            }
            note={
              liveFinished && (liveText || live.error)
                ? 'Go Live starts a new transcript and replaces this one. Copy or download it first to keep it.'
                : undefined
            }
          >
            {live.error && (
              <InlineNotice
                tone="destructive"
                size="sm"
                data-testid="stt-live-error"
              >
                {live.error}
              </InlineNotice>
            )}
            {live.isFlushing && (
              <div className="text-muted-foreground flex items-center gap-2">
                <Loader aria-hidden className="h-4 w-4 animate-spin" />
                Finishing...
              </div>
            )}
            {liveText ? (
              <span data-testid="stt-result-text">{liveText}</span>
            ) : live.voice.transcribing ? null : live.voice.speaking ? (
              'Speech detected. Its transcript appears when you pause.'
            ) : live.isActive ? (
              'Listening for speech...'
            ) : (
              'Live transcript will appear here as you speak...'
            )}
            {live.voice.transcribing && (
              <div
                className="text-muted-foreground flex items-center gap-2"
                data-testid="stt-live-pending"
              >
                <Loader aria-hidden className="h-4 w-4 animate-spin" />
                Transcribing...
              </div>
            )}
          </TranscriptPanel>
        )}
      </div>
    </DemoLayout>
  )
}
