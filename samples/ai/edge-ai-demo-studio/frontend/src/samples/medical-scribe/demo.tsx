// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import {
  useOptionalServiceGroup,
  useTextGenerationParams,
} from '@/samples/common/hooks'
import { SampleParamsSlot } from '@/samples/common/sample-params-slot'
import { DIARIZATION_DEFAULTS, useDiarize } from '@/services/diarization/hooks'
import { useTranscribe } from '@/services/speech-to-text/hooks'
import { useLiveStream } from '@/services/speech-to-text/hooks'
import type { Sample } from '../types'
import { DialoguePanel } from './components/dialogue-panel'
import { DoctorProfileSheet } from './components/doctor-profile-sheet'
import { SessionPanel } from './components/session-panel'
import { SoapReportPanel } from './components/soap-report-panel'
import {
  useDoctorProfiles,
  useRecording,
  useSessions,
  useSoapReport,
} from './hooks'
import type { TranscriptEntry } from './types'
import { alignTranscriptWithSegments, formatTimestamp } from './utils'
import { logger } from '@/lib/logger'
import { SOAP_SYSTEM_PROMPT } from './hooks/use-soap-report'

export function MedicalScribeDemo({ sample }: { sample: Sample }) {
  return (
    <Suspense fallback={null}>
      <MedicalScribeDemoInner sample={sample} />
    </Suspense>
  )
}

function MedicalScribeDemoInner({ sample: _sample }: { sample: Sample }) {
  const textGen = useTextGenerationParams({
    initial: {
      systemPrompt: SOAP_SYSTEM_PROMPT,
    },
  })
  const diarizationGroup = useOptionalServiceGroup({
    serviceId: 'diarization',
    serviceLabel: 'Diarization',
    offlineMessage:
      'Start the Diarization service to enable speaker identification.',
    initialEnabled: true,
    optional: true,
  })
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const { profiles, addProfile, removeProfile, updateEmbedding } =
    useDoctorProfiles()
  const { sessions, isFetched, createSession, updateSession, deleteSession } =
    useSessions()
  const { isRecording, startRecording, stopRecording } = useRecording()
  const liveTranscription = useLiveStream()
  const [liveTranscripts, setLiveTranscripts] = useState<TranscriptEntry[]>([])
  // Mirror of `liveTranscripts` for callbacks that must read the latest value
  // without being re-created on every incoming utterance.
  const liveTranscriptsRef = useRef<TranscriptEntry[]>([])
  const [recordingDuration, setRecordingDuration] = useState<number | null>(
    null,
  )
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  )
  const [audioDurations, setAudioDurations] = useState<
    Record<string, number | null>
  >({})
  const setSessionDuration = useCallback(
    (sessionId: string, value: number | null) => {
      setAudioDurations((prev) => ({ ...prev, [sessionId]: value }))
    },
    [],
  )
  const paramSessionId = searchParams.get('session')
  const selectedSessionId = isFetched
    ? (sessions.find((s) => s.id === paramSessionId)?.id ??
      sessions[0]?.id ??
      null)
    : null

  useEffect(() => {
    if (!isFetched) return
    if (!paramSessionId) return
    if (!selectedSessionId) return
    if (paramSessionId === selectedSessionId) return
    const params = new URLSearchParams(searchParams.toString())
    params.set('session', selectedSessionId)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [
    isFetched,
    paramSessionId,
    selectedSessionId,
    router,
    pathname,
    searchParams,
  ])

  const reconciledRef = useRef(false)
  useEffect(() => {
    if (!isFetched) return
    if (reconciledRef.current) return
    reconciledRef.current = true
    sessions.forEach((s) => {
      if (s.status === 'processing' || s.status === 'recording') {
        updateSession(s.id, {
          status: 'error',
          errorMessage:
            'Processing was interrupted by a page reload. Please record or upload again.',
        })

        toast.error(
          'Processing was interrupted by a page reload. Please record or upload again.',
        )
      }
    })
  }, [isFetched, sessions, updateSession])

  const [generatingSessionId, setGeneratingSessionId] = useState<string | null>(
    null,
  )

  const transcribe = useTranscribe()
  const diarize = useDiarize()
  const soapReport = useSoapReport({
    temperature: textGen.values.temperature,
    maxTokens: textGen.values.maxTokens,
    systemPrompt: textGen.values.systemPrompt || undefined,
    disableReasoning: textGen.values.disableReasoning,
    onFinish: (text) => {
      if (generatingSessionId) {
        updateSession(generatingSessionId, {
          soapReport: text,
          reportCreatedAt: formatTimestamp(new Date()),
        })
        setGeneratingSessionId(null)
      }
    },
  })

  const selectedSession = sessions.find((s) => s.id === selectedSessionId)

  const processAudioRef = useRef<
    (
      sessionId: string,
      audio: Blob,
      knownDuration?: number,
      liveSegments?: TranscriptEntry[],
    ) => Promise<void>
  >(() => Promise.resolve())

  const processAudio = useCallback(
    async (
      sessionId: string,
      audio: Blob,
      knownDuration?: number,
      liveSegments?: TranscriptEntry[],
    ) => {
      const session = sessions.find((s) => s.id === sessionId)
      if (!session) return

      setSessionDuration(sessionId, null)
      updateSession(sessionId, { status: 'processing', audioBlob: audio })

      if (knownDuration != null) {
        setSessionDuration(sessionId, knownDuration)
      } else {
        try {
          const url = URL.createObjectURL(audio)
          const audioEl = new Audio(url)
          await new Promise<void>((resolve) => {
            audioEl.onloadedmetadata = () => resolve()
            audioEl.onerror = () => resolve()
          })
          if (isFinite(audioEl.duration))
            setSessionDuration(sessionId, audioEl.duration)
          URL.revokeObjectURL(url)
        } catch {
          logger.warn('Could not read audio duration')
        }
      }

      try {
        const doctorProfile = profiles.find(
          (p) => p.id === session.doctorProfileId,
        )

        // The live pass already transcribed this audio utterance by utterance.
        // Reuse it and run diarization alone rather than transcribing the whole
        // recording a second time.
        const reusable = (liveSegments ?? []).filter((s) => s.text.trim())
        const liveResult =
          reusable.length > 0
            ? {
                text: reusable.map((s) => s.text.trim()).join(' '),
                segments: reusable.map((s) => ({
                  start: s.start,
                  end: s.end,
                  text: s.text.trim(),
                })),
              }
            : null
        if (liveResult) {
          logger.info(
            `Reusing ${reusable.length} live utterance(s); skipping batch transcription`,
          )
        }

        const [transcriptResult, diarizeResult] = await Promise.all([
          liveResult ??
            transcribe.mutateAsync({
              file: audio,
              language: session.language,
              useDenoise: false,
              returnTimestamps: true,
            }),
          diarizationGroup.enabled
            ? diarize.mutateAsync({
                file: audio,
                speakerMatchThreshold:
                  DIARIZATION_DEFAULTS.speakerMatchThreshold,
                ...(doctorProfile?.embedding
                  ? {
                      referenceEmbedding: doctorProfile.embedding,
                      referenceLabel: 'Doctor',
                      otherLabel: 'Patient',
                    }
                  : { numSpeakers: 2 }),
              })
            : Promise.resolve(null),
        ])

        const transcripts = diarizeResult
          ? alignTranscriptWithSegments(
              transcriptResult.text,
              diarizeResult.segments,
              transcriptResult.segments,
            )
          : liveResult
            ? // No diarization: keep the natural per-utterance split the live
              // pass already produced instead of collapsing it into one block.
              liveResult.segments.map((s) => ({ speaker: 'Speaker', ...s }))
            : [
                {
                  speaker: 'Speaker',
                  text: transcriptResult.text,
                  start: transcriptResult.segments?.[0]?.start ?? 0,
                  end: transcriptResult.segments?.at(-1)?.end ?? 0,
                },
              ]

        updateSession(sessionId, {
          status: 'completed',
          transcripts,
          dialogueCreatedAt: formatTimestamp(new Date()),
        })
        toast.success('Audio processed successfully')
      } catch {
        updateSession(sessionId, {
          status: 'error',
          errorMessage: 'Failed to process audio',
        })
        toast.error('Failed to process audio')
      } finally {
        setSessionDuration(sessionId, null)
      }
    },
    [
      sessions,
      profiles,
      transcribe,
      diarize,
      diarizationGroup.enabled,
      updateSession,
      setSessionDuration,
    ],
  )

  useEffect(() => {
    processAudioRef.current = processAudio
  })

  const handleStartRecording = useCallback(async () => {
    if (!selectedSessionId) return
    const sessionId = selectedSessionId
    const session = sessions.find((s) => s.id === sessionId)
    try {
      updateSession(sessionId, { status: 'recording' })
      setLiveTranscripts([])
      liveTranscriptsRef.current = []
      const timeOrigin = await startRecording()
      // The live pass is the source of truth for the transcript text; batch
      // transcription only runs as a fallback when it is unavailable.
      try {
        await liveTranscription.start({
          language: session?.language ?? 'en',
          timeOrigin,
          onTranscript: (t) => {
            const entry: TranscriptEntry = {
              speaker: '',
              text: t.text,
              start: t.start,
              end: t.end,
            }
            liveTranscriptsRef.current = [...liveTranscriptsRef.current, entry]
            setLiveTranscripts(liveTranscriptsRef.current)
          },
        })
      } catch {
        logger.warn(
          'Live transcription unavailable; falling back to batch only',
        )
      }
      setRecordingDuration(0)
      if (recordingIntervalRef.current)
        clearInterval(recordingIntervalRef.current)
      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration((prev) => (prev !== null ? prev + 1 : 0))
      }, 1000)
    } catch {
      updateSession(sessionId, { status: 'idle' })
      toast.error('Failed to access microphone')
    }
  }, [
    selectedSessionId,
    sessions,
    startRecording,
    liveTranscription,
    updateSession,
  ])

  const handleStopRecording = useCallback(async () => {
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current)
      recordingIntervalRef.current = null
    }
    const duration = recordingDuration
    setRecordingDuration(null)
    // Mark the session as processing up front: flushing the final utterance
    // takes a moment, and without this the dialogue panel would briefly fall
    // back to the (still empty) stored transcripts.
    if (selectedSessionId) {
      updateSession(selectedSessionId, { status: 'processing' })
    }
    // Wait for the worker to transcribe the final pending utterance, otherwise
    // the last thing said would be missing from the reused transcript.
    const [, blob] = await Promise.all([
      liveTranscription.stop(),
      stopRecording(),
    ])
    if (!selectedSessionId) return
    if (blob.size > 0) {
      processAudioRef.current(
        selectedSessionId,
        blob,
        duration ?? undefined,
        liveTranscriptsRef.current,
      )
    } else {
      updateSession(selectedSessionId, { status: 'idle' })
    }
  }, [
    stopRecording,
    liveTranscription,
    selectedSessionId,
    recordingDuration,
    updateSession,
  ])

  const handleUploadAudio = useCallback(
    (file: File) => {
      if (!selectedSessionId) return
      setRecordingDuration(null)
      processAudioRef.current(selectedSessionId, file)
    },
    [selectedSessionId],
  )

  const handleGenerateReport = useCallback(() => {
    if (!selectedSession || selectedSession.transcripts.length === 0) return

    setGeneratingSessionId(selectedSession.id)

    const dialogue = selectedSession.transcripts
      .map((t) => `${t.speaker}: ${t.text}`)
      .join('\n\n')

    soapReport.generate(dialogue)
  }, [selectedSession, soapReport])

  const handleSelectSession = useCallback(
    (id: string) => {
      if (!soapReport.isGenerating) {
        soapReport.reset()
      }
      const params = new URLSearchParams(searchParams)
      params.set('session', id)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [soapReport, router, pathname, searchParams],
  )

  const handleUpdateReport = useCallback(
    (report: string) => {
      if (!selectedSessionId) return
      updateSession(selectedSessionId, {
        soapReport: report,
        reportCreatedAt: formatTimestamp(new Date()),
      })
    },
    [selectedSessionId, updateSession],
  )

  const selectedIsGenerating =
    generatingSessionId === selectedSessionId && soapReport.isGenerating
  const isProcessing = selectedSession?.status === 'processing'

  return (
    <div className="flex h-[calc(100dvh-12rem)] flex-col">
      <SampleParamsSlot groups={[textGen.group, diarizationGroup.group]} />

      <div className="grid min-h-0 flex-1 grid-cols-[280px_1fr_1fr] overflow-hidden">
        <SessionPanel
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          onSelectSession={handleSelectSession}
          onCreateSession={createSession}
          onDeleteSession={deleteSession}
          onUpdateSession={updateSession}
          doctorProfiles={profiles}
          isRecording={isRecording}
          onStartRecording={handleStartRecording}
          onStopRecording={handleStopRecording}
          onUploadAudio={handleUploadAudio}
          onGenerateReport={handleGenerateReport}
          isProcessing={isProcessing}
          isGeneratingReport={selectedIsGenerating}
          isAnyReportGenerating={soapReport.isGenerating}
          profileActions={
            <DoctorProfileSheet
              profiles={profiles}
              onAdd={addProfile}
              onRemove={removeProfile}
              onUpdateEmbedding={updateEmbedding}
            />
          }
        />

        <DialoguePanel
          transcripts={
            isRecording || (isProcessing && liveTranscripts.length > 0)
              ? liveTranscripts
              : (selectedSession?.transcripts ?? [])
          }
          dialogueCreatedAt={selectedSession?.dialogueCreatedAt ?? ''}
          isRecording={isRecording}
          isProcessing={isProcessing}
          audioDuration={audioDurations[selectedSessionId ?? ''] ?? undefined}
          recordingDuration={recordingDuration ?? undefined}
        />

        <SoapReportPanel
          message={selectedIsGenerating ? soapReport.message : undefined}
          isGenerating={selectedIsGenerating}
          savedReport={selectedSession?.soapReport}
          onUpdateReport={handleUpdateReport}
          reportCreatedAt={selectedSession?.reportCreatedAt ?? ''}
        />
      </div>
    </div>
  )
}
