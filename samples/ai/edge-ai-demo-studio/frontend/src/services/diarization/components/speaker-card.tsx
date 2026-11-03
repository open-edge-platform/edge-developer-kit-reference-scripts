// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { CircleAlert, CircleCheck, Loader, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { AudioDropZone } from '@/services/common/components/audio-drop-zone'
import { type EnrolledSpeaker, SPEAKER_COLORS } from '../lib/speakers'

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
          aria-label="Speaker name"
          placeholder="Speaker name"
          className="h-7 flex-1 text-xs"
          disabled={disabled}
        />
        <div className="flex w-5 shrink-0 items-center justify-center">
          {speaker.status === 'enrolling' && (
            <Loader
              aria-label="Enrolling"
              className="text-muted-foreground h-3.5 w-3.5 animate-spin"
            />
          )}
          {speaker.status === 'enrolled' && (
            <CircleCheck
              aria-label="Enrolled"
              className="text-success h-3.5 w-3.5"
            />
          )}
          {speaker.status === 'error' && (
            <CircleAlert
              aria-label="Enrollment failed"
              className="text-destructive h-3.5 w-3.5"
            />
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="text-muted-foreground hover:text-foreground hover:bg-muted/50 flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-50"
          aria-label={`Remove ${speaker.label}`}
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
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
        <p role="alert" className="text-destructive text-xs">
          {speaker.error}
        </p>
      )}
    </div>
  )
}
