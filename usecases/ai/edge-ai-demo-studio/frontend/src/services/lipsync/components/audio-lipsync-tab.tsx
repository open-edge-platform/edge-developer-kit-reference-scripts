// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { FileAudio, Loader2, Play, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAudioLipsync } from '../hooks'

const SUPPORTED_AUDIO_FORMATS = ['.wav', '.mp3']

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
  const audioInputRef = useRef<HTMLInputElement>(null)

  const audioLipsync = useAudioLipsync()
  const isConnected = sessionId !== null

  const handleAudioFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!SUPPORTED_AUDIO_FORMATS.includes(ext)) {
      toast.error(
        `Unsupported audio format. Please use: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`,
      )
      return
    }
    setSelectedAudioFile(file)
  }

  const clearAudioFile = () => {
    setSelectedAudioFile(null)
    if (audioInputRef.current) audioInputRef.current.value = ''
  }

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

      <div>
        <input
          data-testid="lipsync-audio-input"
          ref={audioInputRef}
          type="file"
          accept={SUPPORTED_AUDIO_FORMATS.join(',')}
          onChange={handleAudioFileSelect}
          disabled={!isConnected || audioLipsync.isPending}
          className="hidden"
        />
        {selectedAudioFile ? (
          <div className="border-primary/30 bg-primary/5 flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-2 overflow-hidden">
              <FileAudio className="text-primary h-4 w-4 shrink-0" />
              <span className="truncate text-sm font-medium">
                {selectedAudioFile.name}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs">
                ({(selectedAudioFile.size / 1024).toFixed(0)} KB)
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={clearAudioFile}
              disabled={audioLipsync.isPending}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            className="border-border hover:border-primary/40 hover:bg-muted/30 flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => audioInputRef.current?.click()}
            disabled={!isConnected || audioLipsync.isPending}
          >
            <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-full">
              <FileAudio className="text-muted-foreground h-5 w-5" />
            </div>
            <div className="text-center">
              <p className="text-foreground text-sm font-medium">
                Click to upload audio
              </p>
              <p className="text-muted-foreground text-xs">
                WAV or MP3 · Converted to 16kHz mono
              </p>
            </div>
          </button>
        )}
      </div>

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
