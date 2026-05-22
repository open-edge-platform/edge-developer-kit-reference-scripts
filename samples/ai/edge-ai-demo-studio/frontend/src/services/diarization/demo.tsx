// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader2, Users } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { AudioDropZone } from '@/services/common/components/audio-drop-zone'
import { DemoParameterSidebar } from '@/services/common/demo/components/demo-parameter-sidebar'
import type { Service } from '@/services/types'
import { DiarizationResults } from './components/diarization-results'
import { type EnrolledSpeaker, createSpeaker } from './components/shared'
import { SpeakerEnrollmentPanel } from './components/speaker-enrollment-panel'
import {
  useDiarize,
  useDiarizationParams,
  useEnrollSpeaker,
  type SpeakerProfile,
} from './hooks'

export function DiarizationDemo(_props: { service: Service }) {
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [speakers, setSpeakers] = useState<EnrolledSpeaker[]>([])

  const { values: diarizationValues, params: diarizationParams } =
    useDiarizationParams()

  const enrollMutation = useEnrollSpeaker()
  const diarizeMutation = useDiarize()

  const isProcessing = diarizeMutation.isPending

  // ── Speaker management ────────────────────────────────────────────────
  const addSpeaker = () => {
    setSpeakers((prev) => [...prev, createSpeaker(prev.length + 1)])
  }

  const removeSpeaker = (id: string) => {
    setSpeakers((prev) => prev.filter((s) => s.id !== id))
  }

  const updateSpeaker = (id: string, patch: Partial<EnrolledSpeaker>) => {
    setSpeakers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    )
  }

  const handleFileChange = (speaker: EnrolledSpeaker, file: File | null) => {
    if (!file) {
      updateSpeaker(speaker.id, {
        file: null,
        embedding: null,
        status: 'idle',
        error: undefined,
      })
      return
    }

    updateSpeaker(speaker.id, { file, status: 'enrolling', error: undefined })
    enrollMutation.mutate(file, {
      onSuccess: (data) => {
        updateSpeaker(speaker.id, {
          embedding: data.embedding,
          status: 'enrolled',
        })
      },
      onError: (err) => {
        updateSpeaker(speaker.id, {
          status: 'error',
          error: err.message,
        })
      },
    })
  }

  // ── Diarize ────────────────────────────────────────────────────────────
  const enrolledProfiles: SpeakerProfile[] = speakers
    .filter(
      (s): s is EnrolledSpeaker & { embedding: number[] } =>
        s.status === 'enrolled' && s.embedding !== null,
    )
    .map((s) => ({ label: s.label, embedding: s.embedding }))

  const handleDiarize = () => {
    if (!audioFile) return
    diarizeMutation.mutate({
      file: audioFile,
      speakerProfiles:
        enrolledProfiles.length > 0 ? enrolledProfiles : undefined,
      speakerMatchThreshold: diarizationValues.speakerMatchThreshold,
      unknownLabel:
        enrolledProfiles.length > 0
          ? diarizationValues.unknownLabel
          : undefined,
    })
  }

  // ── Derived state ────────────────────────────────────────────────────
  const segments = diarizeMutation.data?.segments

  // Unified color map: seed from enrollment order, then fill from results
  const speakerMap = new Map<string, number>()
  for (const [i, s] of speakers.entries()) {
    if (s.status === 'enrolled') speakerMap.set(s.label, i)
  }
  if (segments) {
    for (const seg of segments) {
      if (!speakerMap.has(seg.speaker))
        speakerMap.set(seg.speaker, speakerMap.size)
    }
  }

  const uniqueSpeakers = segments
    ? [...new Set(segments.map((s) => s.speaker))]
    : []
  const totalDuration =
    segments && segments.length > 0
      ? Math.max(...segments.map((s) => s.end))
      : 0

  const enrolledCount = speakers.filter((s) => s.status === 'enrolled').length
  const isAnyEnrolling = speakers.some((s) => s.status === 'enrolling')

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <div className="min-w-0 flex-1 space-y-6">
        <SpeakerEnrollmentPanel
          speakers={speakers}
          enrolledCount={enrolledCount}
          open={enrollOpen}
          onOpenChange={setEnrollOpen}
          onAddSpeaker={addSpeaker}
          onRemoveSpeaker={removeSpeaker}
          onLabelChange={(id, label) => updateSpeaker(id, { label })}
          onFileChange={handleFileChange}
          disabled={isProcessing}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Audio input */}
          <div className="space-y-3">
            <p className="text-foreground text-sm font-medium">Audio Input</p>

            <AudioDropZone
              file={audioFile}
              onFileChange={setAudioFile}
              disabled={isProcessing}
            />

            {audioFile && (
              <Button
                className="w-full gap-2"
                onClick={handleDiarize}
                disabled={!audioFile || isProcessing || isAnyEnrolling}
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Users className="h-4 w-4" />
                )}
                {isProcessing ? 'Diarizing…' : 'Diarize'}
              </Button>
            )}
          </div>

          {/* Results */}
          <DiarizationResults
            segments={segments}
            speakerMap={speakerMap}
            uniqueSpeakers={uniqueSpeakers}
            totalDuration={totalDuration}
            isPending={isProcessing}
            isError={diarizeMutation.isError}
            errorMessage={diarizeMutation.error?.message}
          />
        </div>
      </div>

      <div className="shrink-0 space-y-4 xl:w-72">
        <DemoParameterSidebar params={diarizationParams} />
      </div>
    </div>
  )
}
