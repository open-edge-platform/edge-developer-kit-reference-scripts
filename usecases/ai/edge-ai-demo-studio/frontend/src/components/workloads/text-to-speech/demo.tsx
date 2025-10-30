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
import { Textarea } from '@/components/ui/textarea'
import { Slider } from '@/components/ui/slider'
import { useGetVoices, useTextToSpeech } from '@/hooks/use-tts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Play, Zap, Languages, Mic } from 'lucide-react'
import { Workload } from '@/payload-types'
import { TTS_MODELS } from '@/lib/workloads/text-to-speech'
import { SelectLanguage, SelectVoice } from './common'

interface TextToSpeechDemoProps {
  disabled?: boolean
  workload?: Workload
}

export default function TextToSpeechDemo({
  disabled,
  workload,
}: TextToSpeechDemoProps) {
  const [text, setText] = useState('')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [selectedLanguage, setSelectedLanguage] = useState<string>('')
  const [selectedVoice, setSelectedVoice] = useState<string>('')
  const [speed, setSpeed] = useState<number>(1.0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const tts = useTextToSpeech()
  const { data: availableVoices, refetch: refetchVoices } = useGetVoices()

  // Use the model from workload or default to 'kokoro'
  const selectedModel = workload?.model || 'kokoro'

  // Get the current model configuration
  const currentModelConfig = TTS_MODELS.find(
    (model) => model.model === selectedModel,
  )

  // Get available languages for the selected model
  const availableLanguages = useMemo(
    () => currentModelConfig?.languages || [],
    [currentModelConfig],
  )

  // Get available voices for the selected language
  const currentLanguageConfig = availableLanguages.find(
    (lang) => lang.id === selectedLanguage,
  )

  // Group voices by cached status
  const groupedVoices = useMemo(() => {
    if (!currentLanguageConfig || !availableVoices) {
      return { cached: [], notCached: [] }
    }

    const cached: string[] = []
    const notCached: string[] = []

    currentLanguageConfig.voices.forEach((voice) => {
      if (availableVoices[voice] === true) {
        cached.push(voice)
      } else {
        notCached.push(voice)
      }
    })

    return { cached, notCached }
  }, [currentLanguageConfig, availableVoices])

  // Refetch voices if disabled variable changes
  useEffect(() => {
    if (!disabled) {
      refetchVoices()
    }
  }, [disabled, refetchVoices])

  // Initialize default selections when component mounts
  useEffect(() => {
    const modelConfig = TTS_MODELS.find(
      (model) => model.model === selectedModel,
    )
    if (modelConfig && modelConfig.languages.length > 0) {
      const firstLanguage = modelConfig.languages[0]
      setSelectedLanguage(firstLanguage.id)
      setSelectedVoice(firstLanguage.voices[0] || '')
    }
  }, [selectedModel])

  // Update voice when language changes
  useEffect(() => {
    const languageConfig = availableLanguages.find(
      (lang) => lang.id === selectedLanguage,
    )
    if (languageConfig && languageConfig.voices.length > 0) {
      setSelectedVoice(languageConfig.voices[0])
    }
  }, [selectedLanguage, availableLanguages])

  const handleSynthesize = async () => {
    if (!text.trim()) {
      toast.error('Error', {
        description: 'Please enter text to synthesize',
      })
      return
    }

    if (!selectedVoice) {
      toast.error('Error', {
        description: 'Please select a voice',
      })
      return
    }

    setAudioUrl(null)

    tts
      .mutateAsync({
        input: text,
        model: selectedModel,
        voice: selectedVoice,
        responseFormat: 'wav',
        speed,
      })
      .then(async (response) => {
        if (response && response.ok) {
          const blob = await response.blob()
          const url = URL.createObjectURL(blob)
          setAudioUrl(url)
          if (availableVoices?.[selectedVoice] != true) {
            refetchVoices()
          }
        } else {
          toast.error('Error', {
            description: 'Failed to synthesize audio. Please try again.',
          })
        }
      })
      .catch((error) => {
        console.error('TTS error:', error)
        toast.error('Error', {
          description:
            'An error occurred while synthesizing audio. Please try again.',
        })
      })
  }

  useEffect(() => {
    // Clean up the Blob URL when the component unmounts
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
      }
    }
  }, [audioUrl])

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Main TTS Card */}
      <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="h-5 w-5" />
              Interactive Text-to-Speech
            </CardTitle>
            <CardDescription>
              Enter text and generate natural-sounding speech with our
              edge-optimized TTS model.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label
                htmlFor="tts-text"
                className="mb-2 block text-sm font-medium"
              >
                Enter text to synthesize:
              </label>
              <Textarea
                disabled={disabled || tts.isPending}
                id="tts-text"
                placeholder="Type something to hear it spoken aloud..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="min-h-[100px]"
              />
            </div>

            <Button
              onClick={handleSynthesize}
              disabled={disabled || tts.isPending}
              className="w-full"
            >
              {tts.isPending ? (
                <>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-white" />
                  Generating...
                </>
              ) : (
                <>
                  <Zap className="mr-2 h-4 w-4" />
                  Synthesize Speech
                </>
              )}
            </Button>

            {audioUrl && (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <label htmlFor="tts-audio" className="text-sm font-medium">
                    Synthesized Audio:
                  </label>
                </div>
                <audio
                  id="tts-audio"
                  ref={audioRef}
                  controls
                  src={audioUrl}
                  className="w-full"
                >
                  <track kind="captions" />
                </audio>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Voice Settings Card */}
      <div className="lg:col-span-1">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mic className="h-5 w-5" />
              Voice Settings
            </CardTitle>
            <CardDescription>
              Configure the language and voice for text-to-speech synthesis.
              Cached voices are ready instantly, others download on first use.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Language Selection */}
            <div>
              <label
                htmlFor="language-select"
                className="mb-2 block text-sm font-medium"
              >
                <Languages className="mr-1 inline h-4 w-4" />
                Language:
              </label>
              <SelectLanguage
                selectedLanguage={selectedLanguage}
                setSelectedLanguage={setSelectedLanguage}
                availableLanguages={availableLanguages}
                disabled={
                  disabled || tts.isPending || !availableLanguages.length
                }
              />
            </div>

            {/* Voice Selection */}
            <div>
              <label
                htmlFor="voice-select"
                className="mb-2 block text-sm font-medium"
              >
                Voice:
              </label>
              <SelectVoice
                selectedVoice={selectedVoice}
                setSelectedVoice={setSelectedVoice}
                groupedVoices={groupedVoices}
                disabled={disabled || tts.isPending || !currentLanguageConfig}
              />
            </div>

            {/* Speed Configuration */}
            <div>
              <label
                htmlFor="speed-slider"
                className="mb-2 block text-sm font-medium"
              >
                Speed: {speed.toFixed(1)}x
              </label>
              <Slider
                id="speed-slider"
                min={0.3}
                max={2.0}
                step={0.1}
                value={[speed]}
                onValueChange={(value) => setSpeed(value[0])}
                disabled={disabled || tts.isPending}
                className="w-full"
              />
              <div className="text-muted-foreground mt-1 flex justify-between text-xs">
                <span>0.3x</span>
                <span>2.0x</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
