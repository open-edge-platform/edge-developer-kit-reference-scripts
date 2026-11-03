// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AudioDropZone } from '@/services/common/components/audio-drop-zone'
import { demoStateKey } from '@/services/common/demo/demo-session'
import { useSessionState } from '@/services/common/demo/session-store'
import { DemoLayout } from '@/services/common/demo/components/demo-layout'
import { DemoParameterSidebar } from '@/services/common/demo/components/demo-parameter-sidebar'
import type { Service } from '@/services/types'
import {
  type DiarizationView,
  DiarizationResults,
} from './components/diarization-results'
import { SpeakerEnrollmentPanel } from './components/speaker-enrollment-panel'
import { useDiarizationJob, useDiarizationParams } from './hooks'
import { useSpeakerEnrollment } from './hooks/use-speaker-enrollment'
import { speakerColorMap } from './lib/speakers'

export function DiarizationDemo({ service }: { service: Service }) {
  // Kept with the job for the page visit, so a result shown again after
  // switching instances still has its recording.
  const [audioFile, setAudioFile] = useSessionState<File | null>(
    demoStateKey(service, 'diarization:audio'),
    null,
  )

  const { values: diarizationValues, params: diarizationParams } =
    useDiarizationParams({
      sessionKey: demoStateKey(service, 'diarization:params'),
    })
  const enrollment = useSpeakerEnrollment(service)
  const job = useDiarizationJob(service)

  const handleDiarize = () => {
    if (!audioFile) return
    const { profiles } = enrollment
    job.start({
      file: audioFile,
      speakerProfiles: profiles.length > 0 ? profiles : undefined,
      speakerMatchThreshold: diarizationValues.speakerMatchThreshold,
      unknownLabel:
        profiles.length > 0 ? diarizationValues.unknownLabel : undefined,
    })
  }

  const view: DiarizationView = job.isActive
    ? {
        state: 'running',
        queued: job.phase === 'queued',
        status: job.status,
        cancelling: job.cancelling,
        onCancel: job.cancel,
      }
    : job.phase === 'done' && job.result
      ? { state: 'done', segments: job.result.segments }
      : job.phase === 'failed'
        ? {
            state: 'failed',
            message: job.error?.message ?? 'Diarization failed',
          }
        : job.phase === 'cancelled'
          ? { state: 'cancelled' }
          : { state: 'idle' }

  const speakerMap = speakerColorMap(
    enrollment.speakers,
    view.state === 'done' ? view.segments.map((seg) => seg.speaker) : [],
  )

  return (
    <DemoLayout sidebar={<DemoParameterSidebar params={diarizationParams} />}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <h3 className="text-foreground text-sm font-medium">Audio Input</h3>
          <p className="text-muted-foreground text-xs">
            Upload a recording of a conversation, then identify who spoke when.
          </p>

          <AudioDropZone
            file={audioFile}
            onFileChange={setAudioFile}
            disabled={job.isActive}
            inputTestId="diarization-audio-input"
          />

          <SpeakerEnrollmentPanel
            enrollment={enrollment}
            disabled={job.isActive}
          />

          <Button
            className="w-full gap-2"
            onClick={handleDiarize}
            disabled={!audioFile || job.isActive || enrollment.isAnyEnrolling}
            data-testid="diarization-run"
          >
            {job.isActive ? (
              <Loader aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <Users aria-hidden="true" className="h-4 w-4" />
            )}
            {job.isActive ? 'Identifying speakers…' : 'Identify speakers'}
          </Button>
          {enrollment.isAnyEnrolling && (
            <p className="text-muted-foreground text-xs" role="status">
              Waiting for the voice samples to finish enrolling.
            </p>
          )}
        </div>

        <DiarizationResults
          view={view}
          speakerMap={speakerMap}
          recordingName={
            job.input?.file instanceof File
              ? job.input.file.name
              : audioFile?.name
          }
        />
      </div>
    </DemoLayout>
  )
}
