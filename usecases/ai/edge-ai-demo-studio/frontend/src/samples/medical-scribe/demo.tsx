// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  useOptionalServiceGroup,
  useTextGenerationParams,
} from '@/samples/common/hooks'
import { SampleParamsSlot } from '@/samples/common/sample-params-slot'
import { DIARIZATION_DEFAULTS, useDiarize } from '@/services/diarization/hooks'
import { useTranscribe } from '@/services/speech-to-text/hooks'
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
import { alignTranscriptWithSegments } from './utils'

export function MedicalScribeDemo({ sample: _sample }: { sample: Sample }) {
  const textGen = useTextGenerationParams()
  const diarizationGroup = useOptionalServiceGroup({
    serviceId: 'diarization',
    serviceLabel: 'Diarization',
    offlineMessage:
      'Start the Diarization service to enable speaker identification.',
    initialEnabled: true,
    optional: true,
  })
  const { profiles, addProfile, removeProfile, updateEmbedding } =
    useDoctorProfiles()
  const { sessions, isFetched, createSession, updateSession, deleteSession } =
    useSessions()
  const { isRecording, startRecording, stopRecording } = useRecording()
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  )
  const [isProcessing, setIsProcessing] = useState(false)
  useEffect(() => {
    if (isFetched && selectedSessionId === null && sessions.length > 0) {
      setSelectedSessionId(sessions[0].id)
    }
  }, [isFetched, sessions, selectedSessionId])

  const generatingSessionIdRef = useRef<string | null>(null)

  const transcribe = useTranscribe()
  const diarize = useDiarize()
  const soapReport = useSoapReport({
    temperature: textGen.values.temperature,
    maxTokens: textGen.values.maxTokens,
    systemPrompt: textGen.values.systemPrompt || undefined,
    onFinish: (text) => {
      if (generatingSessionIdRef.current) {
        updateSession(generatingSessionIdRef.current, { soapReport: text })
      }
    },
  })

  const selectedSession = sessions.find((s) => s.id === selectedSessionId)

  const processAudioRef = useRef<
    (sessionId: string, audio: Blob) => Promise<void>
  >(() => Promise.resolve())

  const processAudio = useCallback(
    async (sessionId: string, audio: Blob) => {
      const session = sessions.find((s) => s.id === sessionId)
      if (!session) return

      setIsProcessing(true)
      updateSession(sessionId, { status: 'processing', audioBlob: audio })

      try {
        const doctorProfile = profiles.find(
          (p) => p.id === session.doctorProfileId,
        )

        const [transcriptResult, diarizeResult] = await Promise.all([
          transcribe.mutateAsync({
            file: audio,
            language: session.language,
            useDenoise: true,
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
            )
          : [
              {
                speaker: 'Speaker',
                text: transcriptResult.text,
                start: 0,
                end: 0,
              },
            ]

        updateSession(sessionId, {
          status: 'completed',
          transcripts,
        })
        toast.success('Audio processed successfully')
      } catch {
        updateSession(sessionId, {
          status: 'error',
          errorMessage: 'Failed to process audio',
        })
        toast.error('Failed to process audio')
      } finally {
        setIsProcessing(false)
      }
    },
    [
      sessions,
      profiles,
      transcribe,
      diarize,
      diarizationGroup.enabled,
      updateSession,
    ],
  )

  processAudioRef.current = processAudio

  const handleStartRecording = useCallback(async () => {
    if (!selectedSessionId) return
    const sessionId = selectedSessionId
    try {
      updateSession(sessionId, { status: 'recording' })
      await startRecording()
    } catch {
      updateSession(sessionId, { status: 'idle' })
      toast.error('Failed to access microphone')
    }
  }, [selectedSessionId, startRecording, updateSession])

  const handleStopRecording = useCallback(async () => {
    const blob = await stopRecording()
    if (!selectedSessionId) return
    if (blob.size > 0) {
      processAudioRef.current(selectedSessionId, blob)
    } else {
      updateSession(selectedSessionId, { status: 'idle' })
    }
  }, [stopRecording, selectedSessionId, updateSession])

  const handleUploadAudio = useCallback(
    (file: File) => {
      if (!selectedSessionId) return
      processAudioRef.current(selectedSessionId, file)
    },
    [selectedSessionId],
  )

  const handleGenerateReport = useCallback(() => {
    if (!selectedSession || selectedSession.transcripts.length === 0) return

    generatingSessionIdRef.current = selectedSession.id

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
      setSelectedSessionId(id)
    },
    [soapReport],
  )

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
          doctorProfiles={profiles}
          isRecording={isRecording}
          onStartRecording={handleStartRecording}
          onStopRecording={handleStopRecording}
          onUploadAudio={handleUploadAudio}
          onGenerateReport={handleGenerateReport}
          isProcessing={isProcessing}
          isGeneratingReport={soapReport.isGenerating}
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
          transcripts={selectedSession?.transcripts ?? []}
          isRecording={isRecording}
          isProcessing={isProcessing}
        />

        <SoapReportPanel
          message={soapReport.message}
          isGenerating={soapReport.isGenerating}
          savedReport={selectedSession?.soapReport}
        />
      </div>
    </div>
  )
}
