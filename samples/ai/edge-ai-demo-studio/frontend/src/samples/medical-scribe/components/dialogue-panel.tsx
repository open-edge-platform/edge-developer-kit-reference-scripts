// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Check, Clock, Copy, Mic } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
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

      <ScrollArea className="min-h-0 flex-1 p-4">
        {transcripts.length === 0 && !isRecording && !isProcessing && (
          <p className="text-muted-foreground py-8 text-center text-sm">
            Record or upload audio to see the dialogue transcript
          </p>
        )}
        <div className="flex h-full flex-col">
          <div className="flex-1 space-y-3">
            {transcripts.map((entry, i) => {
              const isDoctor = entry.speaker.toLowerCase().includes('doctor')
              return (
                <div key={`${entry.start}-${i}`} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'text-xs font-medium',
                        isDoctor ? 'text-blue-500' : 'text-green-500',
                      )}
                    >
                      {entry.speaker}
                    </span>
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
      </ScrollArea>
      {dialogueCreatedAt && (
        <div className="text-muted-foreground border-t p-4 text-xs">
          Updated {dialogueCreatedAt}
        </div>
      )}
    </div>
  )
}
