// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader, Mic, MicOff, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { VoiceInputControls } from '@/context/voice-input-context'
import { cn } from '@/lib/utils'

/** Voice starts recording, Stop transcribes; a mic error shows on the button with a tooltip. */
export function VoiceInputButton({
  voiceInput,
  disabled,
}: {
  voiceInput: VoiceInputControls
  disabled?: boolean
}) {
  const { isRecording, isPending, micError } = voiceInput
  return (
    <Tooltip open={micError ? undefined : false}>
      <TooltipTrigger asChild>
        <Button
          onClick={
            isRecording ? voiceInput.stopRecording : voiceInput.startRecording
          }
          variant={isRecording ? 'destructive' : micError ? 'outline' : 'ghost'}
          size="sm"
          className={cn(
            'h-7 gap-1.5 px-2 text-xs',
            !isRecording &&
              !micError &&
              'text-muted-foreground hover:text-foreground',
            micError && 'text-destructive border-destructive/50',
          )}
          disabled={disabled || isPending}
          aria-label={isPending ? 'Transcribing voice input' : undefined}
        >
          {isPending ? (
            <Loader aria-hidden className="h-3.5 w-3.5 animate-spin" />
          ) : isRecording ? (
            <>
              <Square aria-hidden className="h-3 w-3" />
              Stop
            </>
          ) : (
            <>
              {micError ? (
                <MicOff aria-hidden className="h-3.5 w-3.5" />
              ) : (
                <Mic aria-hidden className="h-3.5 w-3.5" />
              )}
              Voice
            </>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-56 text-center">
        {micError}
      </TooltipContent>
    </Tooltip>
  )
}
