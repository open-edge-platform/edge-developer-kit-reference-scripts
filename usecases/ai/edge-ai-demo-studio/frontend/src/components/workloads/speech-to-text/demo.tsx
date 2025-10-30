// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useSpeechToText, useTranslation } from '@/hooks/use-stt'
import useAudioRecorder from '@/hooks/use-audio-recorder'
import {
  Upload,
  Mic,
  MicOff,
  Play,
  Trash2,
  FileAudio,
  Languages,
  Volume2,
  AudioWaveform,
} from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { toast } from 'sonner'

interface SpeechToTextDemoProps {
  disabled?: boolean
}

const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'ms', name: 'Malay' },
  { code: 'zh', name: 'Chinese' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ja', name: 'Japanese' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
]

export default function SpeechToTextDemo({ disabled }: SpeechToTextDemoProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [language, setLanguage] = useState('en')
  const [useDenoising, setUseDenoising] = useState(false)
  const [transcriptionResult, setTranscriptionResult] = useState('')
  const [translationResult, setTranslationResult] = useState('')
  const [mode, setMode] = useState<'transcribe' | 'translate'>('transcribe')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const transcription = useSpeechToText()
  const translation = useTranslation()
  const {
    startRecording,
    stopRecording,
    clearRecording,
    recording,
    audioBlob,
    visualizerData,
    durationSeconds,
    isDeviceFound,
  } = useAudioRecorder()

  // Handle audioBlob availability after recording stops
  useEffect(() => {
    if (audioBlob) {
      const file = new File([audioBlob], 'recording.webm', {
        type: 'audio/webm',
      })
      setSelectedFile(file)
    }
  }, [audioBlob])

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      if (!file.type.startsWith('audio/')) {
        toast.error('Error', {
          description: 'Please select an audio file',
        })
        return
      }
      setSelectedFile(file)
      clearRecording()
    }
  }

  const handleProcess = async () => {
    const audioFile =
      selectedFile ||
      (audioBlob
        ? new File([audioBlob], 'recording.webm', {
            type: 'audio/webm',
          })
        : null)

    if (!audioFile) {
      toast.error('Error', {
        description: 'Please select an audio file or record audio',
      })
      return
    }

    try {
      if (mode === 'transcribe') {
        const response = await transcription.mutateAsync({
          file: audioFile,
          language,
          useDenoise: useDenoising,
        })
        setTranscriptionResult(response.text)
        if (response.status) {
          toast.success('Transcription completed')
        }
      } else {
        const response = await translation.mutateAsync({
          file: audioFile,
          language,
        })
        setTranslationResult(response.text)
        toast.success('Translation completed')
      }
    } catch (error) {
      console.error('Processing error:', error)
      toast.error('Error', {
        description: `Failed to ${mode} audio. Please try again.`,
      })
    }
  }

  const isProcessing = transcription.isPending || translation.isPending

  const formatSeconds = (seconds: number) => {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Volume2 className="h-5 w-5" />
          Interactive Speech-to-Text
        </CardTitle>
        <CardDescription>
          Convert speech to text with our edge-optimized model
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Mode Selection */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label>Mode</Label>
            <Select
              value={mode}
              onValueChange={(value: 'transcribe' | 'translate') =>
                setMode(value)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="transcribe">
                  <div className="flex items-center gap-2">
                    <AudioWaveform className="h-4 w-4" />
                    Transcription
                  </div>
                </SelectItem>
                <SelectItem value="translate">
                  <div className="flex items-center gap-2">
                    <Languages className="h-4 w-4" />
                    Translation
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Language Selection */}
          <div className="space-y-2">
            <Label>
              {mode === 'transcribe' ? 'Audio Language' : 'Source Language'}
            </Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {lang.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Denoising Option (only for transcription) */}
        {mode === 'transcribe' && (
          <div className="flex items-center space-x-2">
            <Switch
              id="denoise"
              checked={useDenoising}
              onCheckedChange={setUseDenoising}
              disabled={disabled || isProcessing}
            />
            <Label htmlFor="denoise">Enable audio denoising</Label>
          </div>
        )}

        <Separator />

        {/* Audio Input Methods */}
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* File Upload */}
            <div className="space-y-2">
              <Label>Upload Audio File</Label>
              <div className="flex flex-col gap-2">
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  onChange={handleFileSelect}
                  disabled={disabled || isProcessing}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled || isProcessing}
                  className="w-full"
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Choose Audio File
                </Button>
                {selectedFile && !audioBlob && (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <FileAudio className="h-4 w-4" />
                    {selectedFile.name}
                  </div>
                )}
              </div>
            </div>

            {/* Audio Recording */}
            <div className="space-y-2">
              <Label>Record Audio</Label>
              <div className="flex flex-col gap-2">
                {!recording ? (
                  <Button
                    variant="outline"
                    onClick={startRecording}
                    disabled={disabled || isProcessing || !isDeviceFound}
                    className="w-full"
                  >
                    <Mic className="mr-2 h-4 w-4" />
                    {!isDeviceFound
                      ? 'Microphone not found'
                      : 'Start Recording'}
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <Button
                      variant="destructive"
                      onClick={stopRecording}
                      className="w-full"
                    >
                      <MicOff className="mr-2 h-4 w-4" />
                      Stop Recording
                    </Button>

                    {/* Audio Visualization */}
                    <div className="flex items-center justify-between overflow-hidden rounded-lg border bg-slate-50 p-3">
                      <span className="text-sm text-gray-600">
                        {formatSeconds(durationSeconds)}
                      </span>
                      <div className="mx-4 flex h-8 flex-1 items-center gap-0.5 overflow-hidden">
                        {visualizerData.slice(-100).map((rms, index) => (
                          <div
                            key={index}
                            className="w-1 rounded-sm bg-blue-500"
                            style={{
                              height: `${Math.min(100, Math.max(8, rms * 100))}%`,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                {audioBlob && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-green-600">
                      Recording ready
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearRecording}
                      disabled={disabled || isProcessing}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Process Button */}
        <Button
          onClick={handleProcess}
          disabled={disabled || isProcessing || (!selectedFile && !audioBlob)}
          className="w-full"
        >
          {isProcessing ? (
            <>
              <div className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-white" />
              {mode === 'transcribe' ? 'Transcribing...' : 'Translating...'}
            </>
          ) : (
            <>
              {mode === 'transcribe' ? (
                <Play className="mr-2 h-4 w-4" />
              ) : (
                <Languages className="mr-2 h-4 w-4" />
              )}
              {mode === 'transcribe' ? 'Transcribe Audio' : 'Translate Audio'}
            </>
          )}
        </Button>

        {/* Results */}
        {(transcriptionResult || translationResult) && (
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <Label>
                {mode === 'transcribe'
                  ? 'Transcription Result:'
                  : 'Translation Result:'}
              </Label>
            </div>
            <div className="rounded-lg border bg-slate-50 p-4">
              <p className="text-slate-700">
                {mode === 'transcribe'
                  ? transcriptionResult
                  : translationResult}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
