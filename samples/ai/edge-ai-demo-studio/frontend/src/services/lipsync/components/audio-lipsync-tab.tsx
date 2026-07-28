// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader2, Play } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { AudioDropZone } from '@/services/common/components/audio-drop-zone'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAudioLipsync } from '../hooks'

const SUPPORTED_AUDIO_FORMATS = '.wav,.mp3'

const LANGUAGE_OPTIONS = [
  { code: 'en-US', name: 'English' },
  { code: 'es-ES', name: 'Spanish' },
  { code: 'fr-FR', name: 'French' },
  { code: 'de-DE', name: 'German' },
  { code: 'ja-JP', name: 'Japanese' },
  { code: 'ko-KR', name: 'Korean' },
  { code: 'zh-CN', name: 'Chinese' },
]

export interface AudioLipsyncTabProps {
  sessionId: string | null
}

export function AudioLipsyncTab({ sessionId }: AudioLipsyncTabProps) {
  const [selectedAudioFile, setSelectedAudioFile] = useState<File | null>(null)
  const [textOverlay, setTextOverlay] = useState('')
  const [languageCode, setLanguageCode] = useState('en-US')

  const audioLipsync = useAudioLipsync()
  const isConnected = sessionId !== null

  const clearAudioFile = () => setSelectedAudioFile(null)

  const handleProcessAudio = () => {
    if (!selectedAudioFile || !sessionId) return
    audioLipsync.mutate(
      {
        audioFile: selectedAudioFile,
        sessionId,
        textOverlay: textOverlay.trim() || undefined,
        languageCode,
      },
      {
        onSuccess: () => {
          toast.success(
            `Audio file "${selectedAudioFile.name}" is being processed for lipsync`,
          )
          clearAudioFile()
        },
        onError: () =>
          toast.error('Failed to process audio file. Please try again.'),
      },
    )
  }

  return (
    <>
      <p className="text-muted-foreground text-xs">
        Upload an audio file to sync with the avatar.
      </p>

      <AudioDropZone
        file={selectedAudioFile}
        onFileChange={setSelectedAudioFile}
        accept={SUPPORTED_AUDIO_FORMATS}
        strictExtensions
        disabled={!isConnected || audioLipsync.isPending}
        compact
        label="Click to upload audio"
        hint="WAV or MP3 · Converted to 16kHz mono"
        inputTestId="lipsync-audio-input"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label
            htmlFor="language-select"
            className="text-muted-foreground text-xs font-medium"
          >
            Language (Optional, needed only if you have text overlay)
          </label>
          <Select
            value={languageCode}
            onValueChange={setLanguageCode}
            disabled={!isConnected || audioLipsync.isPending}
          >
            <SelectTrigger id="language-select" className="text-xs">
              <SelectValue placeholder="Select language" />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGE_OPTIONS.map((option) => (
                <SelectItem
                  key={option.code}
                  value={option.code}
                  className="text-xs"
                >
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor="text-overlay"
              className="text-muted-foreground text-xs font-medium"
            >
              Text Overlay{' '}
              <span className="text-muted-foreground/70">(Optional)</span>
            </label>
            <span className="text-muted-foreground text-xs">
              {textOverlay.length}/200
            </span>
          </div>
          <Textarea
            id="text-overlay"
            placeholder="Text to display on video..."
            value={textOverlay}
            onChange={(e) => setTextOverlay(e.target.value)}
            className="bg-muted/30 min-h-[60px] resize-none text-sm"
            disabled={!isConnected || audioLipsync.isPending}
            maxLength={200}
          />
        </div>
      </div>

      <Button
        data-testid="lipsync-process-button"
        onClick={handleProcessAudio}
        disabled={!selectedAudioFile || !isConnected || audioLipsync.isPending}
        className="bg-primary hover:bg-primary-light gap-2 text-white"
      >
        {audioLipsync.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Play className="h-4 w-4" />
        )}
        {audioLipsync.isPending ? 'Processing Audio...' : 'Process Audio File'}
      </Button>
    </>
  )
}
