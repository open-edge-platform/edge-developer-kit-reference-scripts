// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Check, Clock, Copy, Mic } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { InlineNotice } from '@/components/common/inline-notice'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { formatClock } from '@/lib/browser/format'
import { cn } from '@/lib/utils'
import { formatTimestamp } from '../lib/timestamps'
import type { TranscriptEntry } from '../lib/types'

interface DialoguePanelProps {
  transcripts: TranscriptEntry[]
  dialogueCreatedAt: string
  isRecording: boolean
  isProcessing: boolean
  audioDuration?: number
  recordingDuration?: number
  /** Why the session's last recording or upload failed, if it did. */
  error?: string | null
}

export function DialoguePanel({
  transcripts,
  dialogueCreatedAt,
  isRecording,
  isProcessing,
  audioDuration,
  recordingDuration,
  error,
}: DialoguePanelProps) {
  const { copied, copy } = useCopyToClipboard()
  const containerRef = useRef<HTMLDivElement>(null)

  // Follow new utterances; deferred a frame so the newest entry is laid out, or the scroll
  // lands short and clips the last line.
  useEffect(() => {
    const el = containerRef.current
    if (!el || transcripts.length === 0) return
    const frame = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [transcripts])

  // Also scroll on show/resize: content laid out while hidden has zero height and never scrolls.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      if (el.offsetHeight > 0) {
        el.scrollTop = el.scrollHeight
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const handleCopy = () =>
    copy(transcripts.map((t) => `[${t.speaker}] ${t.text}`).join('\n\n'))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Transcript</h3>
          {isRecording && (
            <>
              <span className="text-destructive flex items-center gap-1 text-xs">
                <Mic className="h-3 w-3 animate-pulse" aria-hidden />
                Recording
              </span>
              {recordingDuration != null && (
                <Badge variant="outline" className="gap-1">
                  <Clock className="h-3 w-3" aria-hidden />
                  {formatClock(recordingDuration)}
                </Badge>
              )}
            </>
          )}
          {isProcessing && (
            <>
              <span className="text-muted-foreground text-xs">Processing…</span>
              {audioDuration != null && (
                <Badge variant="outline" className="gap-1">
                  <Clock className="h-3 w-3" aria-hidden />
                  {formatClock(audioDuration)}
                </Badge>
              )}
            </>
          )}
        </div>
        {transcripts.length > 0 && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={handleCopy}
            aria-label={copied ? 'Transcript copied' : 'Copy transcript'}
            title="Copy transcript"
          >
            {copied ? (
              <Check className="text-success h-3.5 w-3.5" aria-hidden />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden />
            )}
          </Button>
        )}
      </div>

      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto p-4">
        {error && !isRecording && !isProcessing && (
          <InlineNotice tone="destructive" size="sm" className="mb-4">
            {error}
          </InlineNotice>
        )}
        {transcripts.length === 0 && !isRecording && !isProcessing && (
          <p className="text-muted-foreground py-8 text-center text-sm">
            Record or upload audio to see the transcript
          </p>
        )}
        <div className="space-y-3">
          {transcripts.map((entry, i) => {
            const isDoctor = entry.speaker.toLowerCase().includes('doctor')
            return (
              <div key={`${entry.start}-${i}`} className="space-y-1">
                <div className="flex items-center gap-2">
                  {entry.speaker && (
                    <span
                      className={cn(
                        'text-xs font-medium',
                        isDoctor ? 'text-info' : 'text-success',
                      )}
                    >
                      {entry.speaker}
                    </span>
                  )}
                  <span className="text-muted-foreground text-xs">
                    {formatClock(entry.start)} – {formatClock(entry.end)}
                  </span>
                </div>
                <p className="text-sm leading-relaxed">{entry.text}</p>
              </div>
            )
          })}
        </div>
      </div>
      {dialogueCreatedAt && (
        <div className="text-muted-foreground border-t p-4 text-xs">
          Updated {formatTimestamp(dialogueCreatedAt)}
        </div>
      )}
    </div>
  )
}
