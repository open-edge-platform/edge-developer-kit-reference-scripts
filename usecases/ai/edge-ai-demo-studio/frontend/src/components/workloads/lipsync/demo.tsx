// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAudioLipsync } from '@/hooks/use-lipsync'
import { Loader2, FileAudio, X, Play } from 'lucide-react'
import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { AvatarStream } from '@/components/samples/digital-avatar'

export default function LipsyncDemo({
  disabled,
  turnServerIp,
}: {
  disabled?: boolean
  turnServerIp: string
}) {
  const [sessionId, setSessionId] = useState('')
  const [connectionStatus, setConnectionStatus] = useState('disconnected')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [textOverlay, setTextOverlay] = useState('')
  const [languageCode, setLanguageCode] = useState('en-US')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const audioLipsync = useAudioLipsync()

  // Supported audio formats
  const supportedFormats = ['.wav', '.mp3']

  // Available language options
  const languageOptions = [
    { code: 'en-US', name: 'English' },
    { code: 'es-ES', name: 'Spanish' },
    { code: 'fr-FR', name: 'French' },
    { code: 'de-DE', name: 'German' },
    { code: 'ja-JP', name: 'Japanese' },
    { code: 'ko-KR', name: 'Korean' },
    { code: 'zh-CN', name: 'Chinese' },
  ]

  const handleSessionIdChange = (newSessionId: string) => {
    setSessionId(newSessionId)
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      // Check if file type is supported
      const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase()
      if (!supportedFormats.includes(fileExtension)) {
        toast.error(
          `Unsupported file format. Please use: ${supportedFormats.join(', ')}`,
        )
        return
      }
      setSelectedFile(file)
    }
  }

  const handleProcessAudio = async () => {
    if (!selectedFile || !sessionId) return

    try {
      await audioLipsync.mutateAsync({
        audioFile: selectedFile,
        sessionId,
        textOverlay: textOverlay.trim() || undefined,
        languageCode,
      })

      clearSelectedFile()

      toast.success(
        `Audio file "${selectedFile.name}" is being processed for lipsync`,
      )
    } catch {
      toast.error('Failed to process audio file. Please try again.')
    }
  }

  const clearSelectedFile = () => {
    setSelectedFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const isConnected = connectionStatus === 'connected'

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="min-h-[500px] xl:col-span-2">
        <AvatarStream
          disabled={disabled || false}
          onSessionIdChange={handleSessionIdChange}
          connectionStatus={connectionStatus}
          setConnectionStatus={setConnectionStatus}
          turnServerIp={turnServerIp}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileAudio className="h-5 w-5" />
            Audio Lipsync Controls
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            Upload an audio file and configure settings to generate lipsync
            animation
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Step 1: Upload Audio */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="bg-primary text-primary-foreground flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold">
                  1
                </div>
                <h3 className="font-semibold">Upload Audio File</h3>
              </div>

              <div className="ml-9 space-y-1">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      ref={fileInputRef}
                      id="audio-file"
                      type="file"
                      accept={supportedFormats.join(',')}
                      onChange={handleFileSelect}
                      disabled={
                        disabled || !isConnected || audioLipsync.isPending
                      }
                      className="cursor-pointer"
                    />
                  </div>
                  {selectedFile && (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={clearSelectedFile}
                      disabled={audioLipsync.isPending}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                <p className="text-muted-foreground text-xs">
                  Supported: WAV, MP3 <br />• Files are converted to 16kHz mono
                </p>
              </div>
            </div>

            {/* Step 2: Configure Settings */}
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <div className="bg-primary text-primary-foreground flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold">
                  2
                </div>
                <h3 className="font-semibold">Configure Settings</h3>
              </div>

              <div className="ml-9 space-y-2">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label
                      htmlFor="language-select"
                      className="text-sm font-medium"
                    >
                      Language
                    </label>
                    <Select
                      value={languageCode}
                      onValueChange={setLanguageCode}
                      disabled={
                        disabled || !isConnected || audioLipsync.isPending
                      }
                    >
                      <SelectTrigger id="language-select">
                        <SelectValue placeholder="Select language" />
                      </SelectTrigger>
                      <SelectContent>
                        {languageOptions.map((option) => (
                          <SelectItem key={option.code} value={option.code}>
                            {option.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="text-overlay" className="text-sm font-medium">
                    Text Overlay{' '}
                    <span className="text-muted-foreground">(Optional)</span>
                  </label>
                  <Textarea
                    id="text-overlay"
                    placeholder="Enter text to display on the video during playback..."
                    value={textOverlay}
                    onChange={(e) => setTextOverlay(e.target.value)}
                    className="min-h-[80px] resize-none"
                    disabled={
                      disabled || !isConnected || audioLipsync.isPending
                    }
                  />
                </div>
              </div>
            </div>

            {/* Step 3: Process */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="bg-primary text-primary-foreground flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold">
                  3
                </div>
                <h3 className="font-semibold">Generate Lipsync</h3>
              </div>

              <div className="ml-9">
                {audioLipsync.isPending ? (
                  <Button disabled size="lg" className="w-full sm:w-auto">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Processing Audio...
                  </Button>
                ) : (
                  <Button
                    disabled={
                      !selectedFile ||
                      !isConnected ||
                      disabled ||
                      audioLipsync.isPending
                    }
                    onClick={handleProcessAudio}
                    size="lg"
                    className="w-full sm:w-auto"
                  >
                    <Play className="mr-2 h-5 w-5" />
                    Process Audio File
                  </Button>
                )}

                {!isConnected && (
                  <p className="text-muted-foreground mt-1 text-sm">
                    Connect to the avatar stream above to enable processing
                  </p>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
