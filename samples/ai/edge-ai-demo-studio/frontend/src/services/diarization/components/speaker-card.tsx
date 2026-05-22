// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { CircleAlert, CircleCheck, Loader2, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { AudioDropZone } from '@/services/common/components/audio-drop-zone'
import { type EnrolledSpeaker, SPEAKER_COLORS } from './shared'

export function SpeakerCard({
  speaker,
  colorIndex,
  onLabelChange,
  onFileChange,
  onRemove,
  disabled,
}: {
  speaker: EnrolledSpeaker
  colorIndex: number
  onLabelChange: (label: string) => void
  onFileChange: (file: File | null) => void
  onRemove: () => void
  disabled: boolean
}) {
  return (
    <div className="bg-background/50 border-border/50 flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <div
          className={cn(
            'h-2.5 w-2.5 shrink-0 rounded-full',
            SPEAKER_COLORS[colorIndex % SPEAKER_COLORS.length],
          )}
        />
        <Input
          value={speaker.label}
          onChange={(e) => onLabelChange(e.target.value)}
          placeholder="Speaker name"
          className="h-7 flex-1 text-xs"
          disabled={disabled}
        />
        <div className="flex w-5 shrink-0 items-center justify-center">
          {speaker.status === 'enrolling' && (
            <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
          )}
          {speaker.status === 'enrolled' && (
            <CircleCheck className="h-3.5 w-3.5 text-green-500" />
          )}
          {speaker.status === 'error' && (
            <CircleAlert className="text-destructive h-3.5 w-3.5" />
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="text-muted-foreground hover:text-foreground shrink-0 p-0.5 transition-colors disabled:opacity-50"
          aria-label={`Remove ${speaker.label}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <AudioDropZone
        file={speaker.file}
        onFileChange={onFileChange}
        compact
        label="Drop voice sample"
        hint="Short clip of this speaker"
        disabled={disabled}
      />
      {speaker.status === 'error' && speaker.error && (
        <p className="text-destructive text-[11px]">{speaker.error}</p>
      )}
    </div>
  )
}
