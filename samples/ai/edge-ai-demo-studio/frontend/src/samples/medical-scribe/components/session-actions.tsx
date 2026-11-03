// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Clock, Loader, Mic, Square, Upload } from 'lucide-react'
import { TruncatedText } from '@/components/common/truncated-text'
import { UploadButton } from '@/components/common/upload-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatClock } from '@/lib/browser/format'
import { cn } from '@/lib/utils'
import type { Session } from '../lib/types'
import { SESSION_STATUS } from './session-row'

/**
 * Briefly-busy buttons use `aria-disabled` and ignore presses rather than `disabled`, which would
 * drop keyboard focus from the button just pressed.
 */
function busyProps(busy: boolean, onClick: () => void) {
  return {
    'aria-disabled': busy || undefined,
    onClick: busy ? undefined : onClick,
    className: cn(busy && 'cursor-not-allowed opacity-50'),
  }
}

/**
 * The selected session's actions, reachable from every view. The status line names the session
 * acted on, since the list may be out of sight; Stop ends the recording whichever session is selected.
 */
export function SessionActions({
  session,
  recording,
  onStartRecording,
  onStopRecording,
  onUploadAudio,
  onGenerateReport,
  isGeneratingReport,
  isAnyReportGenerating,
  className,
  statusClassName,
}: {
  /** The selected session; without one only the status line shows. */
  session: Session | undefined
  /** The recording in progress, of whichever session; `null` when none is. */
  recording: { sessionName: string; seconds: number } | null
  onStartRecording: () => void
  onStopRecording: () => void
  onUploadAudio: (file: File) => void
  onGenerateReport: () => void
  /** This session's report is being written. */
  isGeneratingReport: boolean
  /** Some session's report is being written (one at a time). */
  isAnyReportGenerating: boolean
  className?: string
  /** Classes of the status line (the demo hides it beside the session list). */
  statusClassName?: string
}) {
  const isRecording = recording !== null
  const isProcessing = session?.status === 'processing'
  return (
    <div
      role="region"
      aria-label="Recording controls"
      data-testid="scribe-controls"
      className={cn(
        'bg-background flex flex-wrap items-center gap-x-4 gap-y-2 border-t p-3',
        className,
      )}
    >
      {/* Beside the buttons where both fit, above them where not. */}
      <SessionStatusLine
        session={session}
        recording={recording}
        className={cn('min-w-0 flex-[1_1_12rem]', statusClassName)}
      />
      {session && (
        <div className="flex flex-wrap gap-2">
          {isRecording ? (
            <Button size="sm" variant="destructive" onClick={onStopRecording}>
              <Square className="h-3.5 w-3.5" aria-hidden />
              Stop
            </Button>
          ) : (
            <Button size="sm" {...busyProps(isProcessing, onStartRecording)}>
              <Mic className="h-3.5 w-3.5" aria-hidden />
              Record
            </Button>
          )}
          <UploadButton
            accept="audio/*"
            onFiles={(files) => onUploadAudio(files[0])}
            size="sm"
            disabled={isRecording || isProcessing}
          >
            <Upload className="h-3.5 w-3.5" aria-hidden />
            Upload
          </UploadButton>
          <Button
            size="sm"
            variant="outline"
            disabled={session.transcripts.length === 0}
            {...busyProps(
              isProcessing || isAnyReportGenerating,
              onGenerateReport,
            )}
          >
            {isGeneratingReport && (
              <Loader className="h-3.5 w-3.5 animate-spin" aria-hidden />
            )}
            Generate report
          </Button>
        </div>
      )}
    </div>
  )
}

/** Which session the controls act on, and what it is doing. */
function SessionStatusLine({
  session,
  recording,
  className,
}: {
  session: Session | undefined
  recording: { sessionName: string; seconds: number } | null
  className?: string
}) {
  if (recording) {
    return (
      <div
        className={cn('flex min-w-0 items-center gap-2 text-sm', className)}
        data-testid="scribe-controls-status"
      >
        <Mic
          className="text-destructive h-4 w-4 shrink-0 animate-pulse"
          aria-hidden
        />
        <span className="text-destructive shrink-0 font-medium">Recording</span>
        <TruncatedText text={recording.sessionName} className="min-w-0" />
        <Badge variant="outline" className="ml-auto shrink-0 gap-1">
          <Clock className="h-3 w-3" aria-hidden />
          {formatClock(recording.seconds)}
        </Badge>
      </div>
    )
  }
  if (!session) {
    return (
      <p
        className={cn('text-muted-foreground text-sm', className)}
        data-testid="scribe-controls-status"
      >
        Create or select a session in Sessions to record.
      </p>
    )
  }
  const status = SESSION_STATUS[session.status]
  return (
    <div
      className={cn('flex min-w-0 items-center gap-2 text-sm', className)}
      data-testid="scribe-controls-status"
    >
      <span
        className={cn('h-2 w-2 shrink-0 rounded-full', status.dot)}
        aria-hidden
      />
      <TruncatedText text={session.name} className="min-w-0 font-medium" />
      <span className="text-muted-foreground shrink-0 text-xs">
        {status.label}
      </span>
    </div>
  )
}
