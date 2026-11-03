// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ChevronDown, Plus, UserCheck } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import type { useSpeakerEnrollment } from '../hooks/use-speaker-enrollment'
import { SpeakerCard } from './speaker-card'

/** Optional speaker profiles, folded away; they only put names on the speakers diarization finds. */
export function SpeakerEnrollmentPanel({
  enrollment,
  disabled,
}: {
  enrollment: ReturnType<typeof useSpeakerEnrollment>
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const { speakers, enrolledCount } = enrollment

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="border-border bg-muted/10 rounded-xl border"
    >
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-4 pt-4 pb-1.5 text-left">
        <UserCheck aria-hidden="true" className="text-primary h-4 w-4" />
        <span className="text-foreground text-sm font-medium">
          Speaker Profiles
        </span>
        <Badge variant="outline" className="text-xs">
          Optional
        </Badge>
        {enrolledCount > 0 && (
          <Badge variant="secondary" className="text-xs">
            {enrolledCount} enrolled
          </Badge>
        )}
        <ChevronDown
          aria-hidden="true"
          className="text-muted-foreground ml-auto h-4 w-4 transition-transform group-data-[state=open]:rotate-180"
        />
      </CollapsibleTrigger>
      <p
        className="text-muted-foreground px-4 pb-4 text-xs"
        data-testid="speaker-profiles-summary"
      >
        Name the people you expect to hear. Without profiles, speakers are
        numbered (SPEAKER_00, SPEAKER_01…).
      </p>

      <CollapsibleContent className="space-y-3 border-t px-4 pt-3 pb-4">
        <p className="text-muted-foreground text-xs">
          Add a short, clear voice sample (a few seconds of one person talking)
          for each person you know is in the recording. Their turns are then
          labelled with their name; voices that match no profile get the Unknown
          Speaker Label. Profiles do not change where the turns are, only what
          they are called, so skip them when numbered speakers are enough. A
          sample is enrolled as soon as it is dropped.
        </p>

        {speakers.length > 0 && (
          <ul className="space-y-2">
            {speakers.map((speaker, i) => (
              <li key={speaker.id}>
                <SpeakerCard
                  speaker={speaker}
                  colorIndex={i}
                  onLabelChange={(label) =>
                    enrollment.renameSpeaker(speaker.id, label)
                  }
                  onFileChange={(file) => enrollment.setSample(speaker, file)}
                  onRemove={() => enrollment.removeSpeaker(speaker.id)}
                  disabled={disabled}
                />
              </li>
            ))}
          </ul>
        )}

        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={enrollment.addSpeaker}
          disabled={disabled}
        >
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          Add Speaker
        </Button>
      </CollapsibleContent>
    </Collapsible>
  )
}
