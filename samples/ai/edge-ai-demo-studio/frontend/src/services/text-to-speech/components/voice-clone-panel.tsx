// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  AlertCircle,
  ChevronRight,
  Loader,
  Mic,
  Square,
  UserPlus,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { InlineNotice } from '@/components/common/inline-notice'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useElapsedMs } from '@/hooks/use-elapsed-ms'
import { useMediaRecorder } from '@/hooks/use-media-recorder'
import { formatElapsed } from '@/lib/browser/format'
import { getErrorMessage } from '@/lib/errors'
import { AudioDropZone } from '@/services/common/components/audio-drop-zone'
import { useClonedVoices } from '../hooks/use-cloned-voices'
import { CLONED_VOICE_NAME, getVoicesForModel } from '../lib/tts-models'

/**
 * Zero-shot voice cloning: a recording (dropped or recorded here), the voice's name and, for the
 * closest likeness, what the recording says. The worker keeps every voice added, for the API too.
 */
export function VoiceClonePanel({
  apiBase,
  model,
  addedVoices,
  onAdded,
  disabled,
}: {
  apiBase: string | undefined
  model: string
  /** Voices already added on the worker, which a new one of the same name replaces. */
  addedVoices: string[]
  onAdded: (voice: string) => void
  disabled: boolean
}) {
  const { add, remove } = useClonedVoices(apiBase)
  const [name, setName] = useState('')
  const [recording, setRecording] = useState<File | null>(null)
  const [transcript, setTranscript] = useState('')
  const recorder = useMediaRecorder()
  const recordedMs = useElapsedMs(recorder.isRecording, { tickMs: 100 })
  // Blocks a second Record while the mic opens, which would leak a stream that is never stopped.
  const [isRecordStarting, setIsRecordStarting] = useState(false)

  const builtIn = getVoicesForModel(model).some((v) => v.id === name)
  const nameError = !name
    ? null
    : builtIn
      ? 'That is the built-in voice; pick another name.'
      : CLONED_VOICE_NAME.test(name)
        ? null
        : 'Use letters, digits, - and _ (up to 40), starting with a letter or digit.'
  const replacing = addedVoices.includes(name)
  const busy = add.isPending || recorder.isRecording || isRecordStarting
  const canAdd =
    !disabled && !busy && Boolean(recording) && Boolean(name) && !nameError

  const toggleRecording = async () => {
    if (recorder.isRecording) {
      const blob = await recorder.stop()
      if (blob.size > 0) {
        setRecording(
          new File([blob], 'recording.webm', {
            type: blob.type || 'audio/webm',
          }),
        )
      }
      return
    }
    setIsRecordStarting(true)
    try {
      await recorder.start()
    } catch {
      // recorder.error already reflects the failure.
    } finally {
      setIsRecordStarting(false)
    }
  }

  const handleAdd = () => {
    if (!recording || !canAdd) return
    remove.reset()
    add.mutate(
      { name, recording, transcript },
      {
        onSuccess: () => {
          onAdded(name)
          setName('')
          setRecording(null)
          setTranscript('')
        },
      },
    )
  }

  const error = add.error ?? remove.error

  return (
    <Collapsible
      data-testid="tts-voice-clone"
      className="group/clone border-border space-y-3 rounded-lg border p-3"
    >
      <CollapsibleTrigger
        data-testid="tts-voice-clone-toggle"
        className="text-foreground hover:text-primary focus-visible:ring-ring/50 flex w-full items-center gap-2 rounded-md text-sm font-medium outline-none focus-visible:ring-[3px]"
      >
        <ChevronRight
          aria-hidden="true"
          className="h-4 w-4 shrink-0 transition-transform duration-150 group-data-[state=open]/clone:rotate-90"
        />
        Clone a voice
        <span className="text-muted-foreground ml-auto text-xs font-normal">
          Zero-shot, from a short recording
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3">
        <div className="space-y-1.5">
          <AudioDropZone
            file={recording}
            onFileChange={setRecording}
            compact
            label="Drop a recording of one speaker"
            hint="3–10 s of clear speech works best"
            disabled={disabled || busy}
            inputTestId="tts-voice-clone-file"
          />
          <Button
            type="button"
            variant={recorder.isRecording ? 'destructive' : 'outline'}
            size="sm"
            className="w-full gap-2"
            onClick={toggleRecording}
            disabled={disabled || add.isPending || isRecordStarting}
          >
            {recorder.isRecording ? (
              <>
                <Square aria-hidden className="h-3.5 w-3.5" />
                Stop recording · {formatElapsed(recordedMs)}
              </>
            ) : (
              <>
                <Mic aria-hidden className="h-3.5 w-3.5" />
                Record from the microphone
              </>
            )}
          </Button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tts-voice-clone-name" className="text-xs">
            Voice name
          </Label>
          <Input
            id="tts-voice-clone-name"
            data-testid="tts-voice-clone-name"
            value={name}
            onChange={(e) => setName(e.target.value.replace(/\s+/g, '_'))}
            placeholder="e.g. my_voice"
            maxLength={40}
            aria-invalid={nameError ? true : undefined}
            className="h-8 text-sm"
            disabled={disabled}
          />
          {nameError && (
            <p role="alert" className="text-destructive text-xs">
              {nameError}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tts-voice-clone-transcript" className="text-xs">
            Transcript (optional)
          </Label>
          <Textarea
            id="tts-voice-clone-transcript"
            data-testid="tts-voice-clone-transcript"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="What the recording says, word for word"
            rows={2}
            className="bg-muted/30 resize-none text-sm"
            disabled={disabled}
          />
          <p className="text-muted-foreground text-xs">
            With it the clone sounds closest to the speaker. Without it the
            recording may be in any language.
          </p>
        </div>

        {(error || recorder.error) && (
          <InlineNotice
            tone="destructive"
            size="sm"
            data-testid="tts-voice-clone-error"
            icon={<AlertCircle aria-hidden className="h-4 w-4 shrink-0" />}
          >
            {error ? getErrorMessage(error) : recorder.error}
          </InlineNotice>
        )}

        <Button
          type="button"
          data-testid="tts-voice-clone-add"
          className="w-full gap-2"
          onClick={handleAdd}
          disabled={!canAdd}
        >
          {add.isPending ? (
            <>
              <Loader aria-hidden className="h-4 w-4 animate-spin" />
              Cloning voice...
            </>
          ) : (
            <>
              <UserPlus aria-hidden className="h-4 w-4" />
              {replacing ? `Replace ${name}` : 'Add voice'}
            </>
          )}
        </Button>

        {addedVoices.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-xs">Added voices</p>
            <ul
              data-testid="tts-added-voices"
              className="divide-border divide-y rounded-md border"
            >
              {addedVoices.map((voice) => (
                <li
                  key={voice}
                  className="flex items-center justify-between gap-2 py-0.5 pr-0.5 pl-2.5"
                >
                  <span className="truncate text-xs">{voice}</span>
                  <button
                    type="button"
                    onClick={() => {
                      add.reset()
                      remove.mutate(voice)
                    }}
                    disabled={disabled || remove.isPending}
                    className="text-muted-foreground hover:text-foreground hover:bg-muted/50 flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-50"
                    aria-label={`Remove voice ${voice}`}
                  >
                    {remove.isPending && remove.variables === voice ? (
                      <Loader
                        aria-hidden
                        className="h-3.5 w-3.5 animate-spin"
                      />
                    ) : (
                      <X aria-hidden className="h-3.5 w-3.5" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
