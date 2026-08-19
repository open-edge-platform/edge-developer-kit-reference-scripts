// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Check, Clock, Copy, Mic } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatDuration } from '../utils'
import type { TranscriptEntry } from '../types'

interface DialoguePanelProps {
  transcripts: TranscriptEntry[]
  dialogueCreatedAt: string
  isRecording: boolean
  isProcessing: boolean
  audioDuration?: number
  recordingDuration?: number
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function DialoguePanel({
  transcripts,
  dialogueCreatedAt,
  isRecording,
  isProcessing,
  audioDuration,
  recordingDuration,
}: DialoguePanelProps) {
  const [copied, setCopied] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Follow new utterances as they stream in. Deferred to the next frame so the
  // newest entry has been laid out — scrolling synchronously in the effect can
  // land short and leave the last line clipped below the fold.
  useEffect(() => {
    const el = containerRef.current
    if (!el || transcripts.length === 0) return
    const frame = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [transcripts])

  // Also scroll when the panel becomes visible or is resized, since content
  // laid out while hidden reports a zero height and never scrolls.
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

  const handleCopy = useCallback(async () => {
    const text = transcripts.map((t) => `[${t.speaker}] ${t.text}`).join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API not available
    }
  }, [transcripts])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Dialogue</h3>
          {isRecording && (
            <>
              <span className="flex items-center gap-1 text-xs text-red-500">
                <Mic className="h-3 w-3 animate-pulse" />
                Recording
              </span>
              {recordingDuration != null && (
                <Badge variant="outline" className="gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDuration(recordingDuration)}
                </Badge>
              )}
            </>
          )}
          {isProcessing && (
            <>
              <span className="text-muted-foreground text-xs">Processing…</span>
              {audioDuration != null && (
                <Badge variant="outline" className="gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDuration(audioDuration)}
                </Badge>
              )}
            </>
          )}
        </div>
        {transcripts.length > 0 && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
      </div>

      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto p-4">
        {transcripts.length === 0 && !isRecording && !isProcessing && (
          <p className="text-muted-foreground py-8 text-center text-sm">
            Record or upload audio to see the dialogue transcript
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
                        isDoctor ? 'text-blue-500' : 'text-green-500',
                      )}
                    >
                      {entry.speaker}
                    </span>
                  )}
                  <span className="text-muted-foreground text-[10px]">
                    {formatTime(entry.start)} – {formatTime(entry.end)}
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
          Updated {dialogueCreatedAt}
        </div>
      )}
    </div>
  )
}
