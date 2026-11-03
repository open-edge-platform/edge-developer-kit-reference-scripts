// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Suspense, useRef, useState } from 'react'
import { useServiceApiBase } from '@/context/service-status-context'
import { useOptionalServiceGroup } from '@/hooks/use-optional-service-group'
import { cn } from '@/lib/utils'
import { useTextGenerationParams } from '@/samples/common/hooks'
import { SampleParamsSlot } from '@/samples/common/sample-params-slot'
import type { Sample } from '../types'
import { DialoguePanel } from './components/dialogue-panel'
import { DoctorProfileSheet } from './components/doctor-profile-sheet'
import { SessionActions } from './components/session-actions'
import { SessionPanel } from './components/session-panel'
import { SoapReportPanel } from './components/soap-report-panel'
import {
  type ScribeView,
  scribePaneId,
  WorkspaceViewSwitcher,
} from './components/workspace-view-switcher'
import { useAudioProcessing } from './hooks/use-audio-processing'
import { useDoctorProfiles } from './hooks/use-doctor-profiles'
import { useInterruptedSessionRecovery } from './hooks/use-interrupted-session-recovery'
import { useLiveRecording } from './hooks/use-live-recording'
import { useSessionSelection } from './hooks/use-session-selection'
import { useSessions } from './hooks/use-sessions'
import { useSoapReport } from './hooks/use-soap-report'
import { SOAP_SYSTEM_PROMPT } from './lib/soap'
import { timestampNow } from './lib/timestamps'

export function MedicalScribeDemo({ sample }: { sample: Sample }) {
  return (
    <Suspense fallback={null}>
      <MedicalScribeDemoInner sample={sample} />
    </Suspense>
  )
}

function MedicalScribeDemoInner({ sample: _sample }: { sample: Sample }) {
  const textGen = useTextGenerationParams({
    initial: { systemPrompt: SOAP_SYSTEM_PROMPT },
  })
  const diarizationGroup = useOptionalServiceGroup({
    serviceId: 'diarization',
    serviceLabel: 'Diarization',
    offlineMessage:
      'Start the Diarization service to enable speaker identification.',
    initialEnabled: true,
    optional: true,
  })

  const apiBase = useServiceApiBase('medical-scribe-database')
  const { profiles, addProfile, removeProfile, updateEmbedding } =
    useDoctorProfiles(apiBase)
  const { sessions, isFetched, createSession, updateSession, deleteSession } =
    useSessions(apiBase)
  const { selectedSessionId, selectSession } = useSessionSelection(
    sessions,
    isFetched,
  )
  useInterruptedSessionRecovery({ sessions, isFetched, updateSession })

  const audio = useAudioProcessing({
    sessions,
    profiles,
    updateSession,
    diarizationEnabled: diarizationGroup.enabled,
  })
  const recording = useLiveRecording({
    updateSession,
    processAudio: audio.processAudio,
  })

  // The pane shown when they are stacked. All stay mounted, so switching never interrupts a
  // recording or a report being written.
  const [view, setView] = useState<ScribeView>('sessions')
  // A report finished while another view was shown on a narrow screen.
  const [reportUnseen, setReportUnseen] = useState(false)
  const switcherRef = useRef<HTMLDivElement>(null)
  /** The panes are stacked (the switcher shows) rather than side by side. */
  const isStacked = () =>
    (switcherRef.current?.getClientRects().length ?? 0) > 0

  const showView = (next: ScribeView) => {
    setView(next)
    if (next === 'report') setReportUnseen(false)
  }

  /**
   * Shows the view an action is about to fill. Focus inside the pane being hidden moves to the
   * new view's switcher button rather than being dropped on the page.
   */
  const advanceTo = (next: ScribeView) => {
    if (!isStacked()) {
      showView(next)
      return
    }
    const focused = document.activeElement
    const pane =
      focused instanceof HTMLElement
        ? focused.closest<HTMLElement>('[data-scribe-pane]')
        : null
    showView(next)
    if (pane && pane.dataset.scribePane !== next) {
      switcherRef.current
        ?.querySelector<HTMLButtonElement>(`[data-view="${next}"]`)
        ?.focus()
    }
  }

  // The session whose report is being written (one at a time).
  const [generatingSessionId, setGeneratingSessionId] = useState<string | null>(
    null,
  )
  const soapReport = useSoapReport({
    textGenValues: textGen.values,
    requestParams: textGen.requestParams,
    onFinish: (text) => {
      if (!generatingSessionId) return
      updateSession(generatingSessionId, {
        soapReport: text,
        reportCreatedAt: timestampNow(),
      })
      setGeneratingSessionId(null)
      // Not pulled into view (that could interrupt reading the transcript):
      // the Report button is marked until it is opened.
      if (view !== 'report' && isStacked()) setReportUnseen(true)
    },
  })

  const selectedSession = sessions.find((s) => s.id === selectedSessionId)
  const isProcessing = selectedSession?.status === 'processing'
  const selectedIsGenerating =
    generatingSessionId === selectedSessionId && soapReport.isGenerating
  // The live transcript stands in for the stored one while its session
  // records, and while that recording is processed.
  const showLiveTranscript =
    recording.liveSessionId === selectedSessionId &&
    (recording.isRecording ||
      (isProcessing && recording.liveTranscripts.length > 0))

  const handleDeleteSession = (id: string) => {
    recording.discard(id)
    audio.cancel(id)
    deleteSession(id)
  }

  const handleGenerateReport = () => {
    if (!selectedSession || selectedSession.transcripts.length === 0) return
    setGeneratingSessionId(selectedSession.id)
    soapReport.generate(
      selectedSession.transcripts
        .map((t) => `${t.speaker}: ${t.text}`)
        .join('\n\n'),
    )
    advanceTo('report')
  }

  // Picking (or creating) a session opens its transcript, as a list opens
  // its item on a phone; the Sessions button leads back.
  const handleSelectSession = (id: string) => {
    if (!soapReport.isGenerating) soapReport.reset()
    selectSession(id)
    advanceTo('transcript')
  }

  const handleStartRecording = () => {
    if (!selectedSession) return
    advanceTo('transcript')
    recording.start(selectedSession)
  }

  const handleUploadAudio = (file: File) => {
    if (!selectedSession) return
    advanceTo('transcript')
    audio.processAudio(selectedSession.id, file)
  }

  const recordingSession = recording.isRecording
    ? sessions.find((s) => s.id === recording.liveSessionId)
    : undefined
  const selectedIsRecording =
    recording.isRecording && recording.liveSessionId === selectedSessionId

  /** Grid placement and visibility of a pane: alone when stacked, a column when not. */
  const paneProps = (pane: ScribeView, placement: string) => ({
    id: scribePaneId(pane),
    'data-scribe-pane': pane,
    'data-testid': `scribe-pane-${pane}`,
    className: cn(
      'col-start-1 row-start-2 min-h-0 flex-col @4xl:flex',
      view === pane ? 'flex' : 'hidden',
      placement,
    ),
  })

  const handleUpdateReport = (report: string) => {
    if (!selectedSessionId) return
    updateSession(selectedSessionId, {
      soapReport: report,
      reportCreatedAt: timestampNow(),
    })
  }

  // Fills the viewport below the header so each pane scrolls on its own. The container query
  // (56rem) gives transcript and report ~300px columns each beside the 280px session list.
  return (
    <div className="@container flex h-[calc(100dvh-12rem)] min-h-[26rem] flex-col">
      <SampleParamsSlot groups={[textGen.group, diarizationGroup.group]} />

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] @4xl:grid-cols-[280px_minmax(0,1fr)_minmax(0,1fr)] @4xl:grid-rows-[minmax(0,1fr)_auto]">
        <WorkspaceViewSwitcher
          ref={switcherRef}
          view={view}
          onChange={showView}
          activity={{
            recording: selectedIsRecording,
            processing: isProcessing,
            generating: selectedIsGenerating,
            reportUnseen,
          }}
          className="col-start-1 row-start-1 mb-2 @4xl:hidden"
        />

        <section
          aria-label="Sessions"
          {...paneProps('sessions', '@4xl:row-start-1 @4xl:border-r')}
        >
          <SessionPanel
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            onSelectSession={handleSelectSession}
            onCreateSession={createSession}
            onDeleteSession={handleDeleteSession}
            onUpdateSession={updateSession}
            doctorProfiles={profiles}
            profileActions={
              <DoctorProfileSheet
                profiles={profiles}
                onAdd={addProfile}
                onRemove={removeProfile}
                onUpdateEmbedding={updateEmbedding}
              />
            }
          />
        </section>

        <section
          aria-label="Transcript"
          {...paneProps(
            'transcript',
            '@4xl:col-start-2 @4xl:row-span-2 @4xl:row-start-1',
          )}
        >
          <DialoguePanel
            transcripts={
              showLiveTranscript
                ? recording.liveTranscripts
                : (selectedSession?.transcripts ?? [])
            }
            dialogueCreatedAt={selectedSession?.dialogueCreatedAt ?? ''}
            isRecording={selectedIsRecording}
            isProcessing={isProcessing}
            audioDuration={
              selectedSessionId
                ? (audio.audioDurations[selectedSessionId] ?? undefined)
                : undefined
            }
            recordingDuration={recording.recordingSeconds}
            error={
              selectedSession?.status === 'error'
                ? (selectedSession.errorMessage ?? 'Processing failed.')
                : null
            }
          />
        </section>

        <section
          aria-label="Report"
          {...paneProps(
            'report',
            '@4xl:col-start-3 @4xl:row-span-2 @4xl:row-start-1 @4xl:border-l',
          )}
        >
          <SoapReportPanel
            message={selectedIsGenerating ? soapReport.message : undefined}
            isGenerating={selectedIsGenerating}
            savedReport={selectedSession?.soapReport}
            onUpdateReport={handleUpdateReport}
            reportCreatedAt={selectedSession?.reportCreatedAt ?? ''}
            error={
              generatingSessionId === selectedSessionId
                ? soapReport.error
                : null
            }
          />
        </section>

        {/* Stacked: sticky under the shown pane. Side by side: the session column's footer. */}
        <SessionActions
          session={selectedSession}
          recording={
            recording.isRecording
              ? {
                  sessionName: recordingSession?.name ?? 'Session',
                  seconds: recording.recordingSeconds,
                }
              : null
          }
          onStartRecording={handleStartRecording}
          onStopRecording={() => void recording.stop()}
          onUploadAudio={handleUploadAudio}
          onGenerateReport={handleGenerateReport}
          isGeneratingReport={selectedIsGenerating}
          isAnyReportGenerating={soapReport.isGenerating}
          statusClassName="@4xl:hidden"
          className={cn(
            'sticky bottom-0 z-10 col-start-1 row-start-3 @4xl:static @4xl:row-start-2 @4xl:border-r',
            !selectedSession && '@4xl:hidden',
          )}
        />
      </div>
    </div>
  )
}
