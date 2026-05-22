// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ChevronDown, Plus, UserCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { EnrolledSpeaker } from './shared'
import { SpeakerCard } from './speaker-card'

export function SpeakerEnrollmentPanel({
  speakers,
  enrolledCount,
  open,
  onOpenChange,
  onAddSpeaker,
  onRemoveSpeaker,
  onLabelChange,
  onFileChange,
  disabled,
}: {
  speakers: EnrolledSpeaker[]
  enrolledCount: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddSpeaker: () => void
  onRemoveSpeaker: (id: string) => void
  onLabelChange: (id: string, label: string) => void
  onFileChange: (speaker: EnrolledSpeaker, file: File | null) => void
  disabled: boolean
}) {
  return (
    <div className="border-border bg-muted/10 rounded-xl border">
      <button
        type="button"
        className="flex w-full items-center gap-2 p-4"
        onClick={() => onOpenChange(!open)}
      >
        <UserCheck className="text-primary h-4 w-4" />
        <span className="text-foreground text-sm font-medium">
          Speaker Profiles
        </span>
        <Badge variant="outline" className="text-[10px]">
          Optional
        </Badge>
        {enrolledCount > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            {enrolledCount} enrolled
          </Badge>
        )}
        <ChevronDown
          className={cn(
            'text-muted-foreground ml-auto h-4 w-4 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="space-y-3 border-t px-4 pt-3 pb-4">
          <p className="text-muted-foreground text-xs">
            Enroll speaker voices for named labels in the diarization output.
            Drop a voice sample to auto-enroll.
          </p>

          {speakers.length > 0 && (
            <div className="space-y-2">
              {speakers.map((speaker, i) => (
                <SpeakerCard
                  key={speaker.id}
                  speaker={speaker}
                  colorIndex={i}
                  onLabelChange={(label) => onLabelChange(speaker.id, label)}
                  onFileChange={(file) => onFileChange(speaker, file)}
                  onRemove={() => onRemoveSpeaker(speaker.id)}
                  disabled={disabled}
                />
              ))}
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={onAddSpeaker}
            disabled={disabled}
          >
            <Plus className="h-3.5 w-3.5" />
            Add Speaker
          </Button>
        </div>
      )}
    </div>
  )
}
