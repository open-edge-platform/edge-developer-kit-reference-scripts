// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Check, ChevronDown, Copy, Download, Eraser } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { downloadBlob } from '@/lib/browser/download'
import {
  type TimedText,
  type TranscriptFormat,
  transcriptFile,
} from '../lib/transcript-export'

/** Copy, download (text, or SRT/WebVTT when segments are timed) and clear a finished transcript. */
export function TranscriptActions({
  text,
  cues,
  sourceName,
  onClear,
  disabled,
}: {
  text: string
  /** Timed segments; subtitle downloads are offered only with some. */
  cues: TimedText[]
  /** Names the downloaded file. */
  sourceName: string
  onClear: () => void
  /** A new transcription is under way, so the transcript is not final. */
  disabled?: boolean
}) {
  const { copied, copy } = useCopyToClipboard()
  const save = (format: TranscriptFormat) => {
    const { blob, fileName } = transcriptFile(format, text, cues, sourceName)
    downloadBlob(blob, fileName)
  }
  const hasText = text.trim().length > 0

  return (
    <div className="flex flex-wrap gap-2" data-testid="stt-transcript-actions">
      <Button
        variant="outline"
        size="sm"
        onClick={() => void copy(text)}
        disabled={disabled || !hasText}
        data-testid="stt-copy"
      >
        {copied ? (
          <Check aria-hidden className="h-3.5 w-3.5" />
        ) : (
          <Copy aria-hidden className="h-3.5 w-3.5" />
        )}
        {copied ? 'Copied' : 'Copy transcript'}
      </Button>
      {cues.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || !hasText}
              data-testid="stt-download"
            >
              <Download aria-hidden className="h-3.5 w-3.5" />
              Download
              <ChevronDown aria-hidden className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => save('txt')}>
              Text (.txt)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => save('srt')}>
              Subtitles (.srt)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => save('vtt')}>
              Subtitles (.vtt)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => save('txt')}
          disabled={disabled || !hasText}
          data-testid="stt-download"
        >
          <Download aria-hidden className="h-3.5 w-3.5" />
          Download .txt
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={onClear}
        disabled={disabled}
        data-testid="stt-clear"
      >
        <Eraser aria-hidden className="h-3.5 w-3.5" />
        Clear
      </Button>
    </div>
  )
}
