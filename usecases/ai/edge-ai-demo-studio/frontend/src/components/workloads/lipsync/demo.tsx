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
import { useAudioLipsync, useSkinUpload } from '@/hooks/use-lipsync'

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
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null)
  const [skinName, setSkinName] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [textOverlay, setTextOverlay] = useState('')
  const [languageCode, setLanguageCode] = useState('en-US')
  const videoInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const audioLipsync = useAudioLipsync()
  const skinUpload = useSkinUpload()

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

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Check if file type is supported
    const allowed = [
      'video/mp4',
      'video/quicktime',
      'video/x-matroska',
      'video/webm',
    ]
    if (!allowed.includes(file.type)) {
      toast.error(`Unsupported file type: ${file.type}`)
      e.target.value = ''
      return
    }
    setSelectedVideo(file)
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

  const handleProcessVideo = async () => {
    if (!selectedVideo || !sessionId) return
    try {
      await skinUpload.mutateAsync({
        videoFile: selectedVideo,
        sessionId,
        skinName: skinName || undefined,
      })

      clearSelectedVideo()

      toast.success(
        `Video file "${selectedVideo.name}" is being processed for lipsync`,
      )
    } catch {
      toast.error('Failed to process video file. Please try again.')
    }
  }

  const clearSelectedVideo = () => {
    setSelectedVideo(null)
    if (videoInputRef.current) {
      videoInputRef.current.value = ''
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
    <div className="grid grid-cols-1 items-stretch gap-6 xl:grid-cols-3">
      <div className="min-h-[500px] xl:col-span-2">
        <AvatarStream
          disabled={disabled || false}
          onSessionIdChange={handleSessionIdChange}
          connectionStatus={connectionStatus}
          setConnectionStatus={setConnectionStatus}
          turnServerIp={turnServerIp}
        />
      </div>

      <div className="flex flex-col gap-6">
        <Card className="flex h-full flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileAudio className="h-5 w-5" />
              Avatar Controls
            </CardTitle>
            <p className="text-muted-foreground text-sm">
              Upload a video file to generate a new avatar skin.
            </p>
          </CardHeader>

          <CardContent>
            <div className="space-y-2">
              <div className="space-y-1">
                <Input
                  id="skin-name"
                  placeholder="Enter skin name"
                  value={skinName}
                  onChange={(e) => setSkinName(e.target.value)}
                  disabled={disabled || !isConnected || skinUpload.isPending}
                />
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    ref={videoInputRef}
                    id="skin-video-file"
                    type="file"
                    accept={[
                      'video/mp4',
                      'video/quicktime',
                      'video/x-matroska',
                      'video/webm',
                    ].join(',')}
                    onChange={handleVideoSelect}
                    disabled={disabled || !isConnected || skinUpload.isPending}
                    className="cursor-pointer"
                  />
                </div>

                {selectedVideo && (
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={clearSelectedVideo}
                    disabled={skinUpload.isPending}
                    title="Clear selected file"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {selectedVideo && (
                <p className="text-muted-foreground text-xs">
                  Selected:{' '}
                  <span className="font-medium">{selectedVideo.name}</span> (
                  {(selectedVideo.size / (1024 * 1024)).toFixed(1)} MB)
                </p>
              )}
              <p className="text-muted-foreground text-xs">
                Supported: MP4, MOV, MKV, WEBM.
              </p>

              <div className="flex gap-2">
                <Button
                  onClick={handleProcessVideo}
                  disabled={!selectedVideo || skinUpload.isPending}
                >
                  {skinUpload.isPending
                    ? 'Uploading & Generating…'
                    : 'Generate Avatar'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="flex h-full flex-col">
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
                        data-testid="lipsync-audio-input"
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
                    Supported: WAV, MP3 <br />• Files are converted to 16kHz
                    mono
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
                    <label
                      htmlFor="text-overlay"
                      className="text-sm font-medium"
                    >
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
                      data-testid="lipsync-process-button"
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
    </div>
  )
}
