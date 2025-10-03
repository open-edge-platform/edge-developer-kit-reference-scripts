// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSendLipsyncMessage } from '@/hooks/use-lipsync'
import { Loader2, Send, Languages, Mic } from 'lucide-react'
import { useState, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { AvatarStream } from '@/components/samples/digital-avatar'
import { useGetWorkloadByType } from '@/hooks/use-workload'
import { TTS_MODELS } from '@/lib/workloads/text-to-speech'
import { Workload } from '@/payload-types'

export default function LipsyncDemo({
  disabled,
  turnServerIp,
  workload,
}: {
  disabled?: boolean
  turnServerIp: string
  workload?: Workload
}) {
  const { isLoading } = useGetWorkloadByType('text-to-speech')
  const [sessionId, setSessionId] = useState('')
  const [connectionStatus, setConnectionStatus] = useState('disconnected')
  const [selectedLanguage, setSelectedLanguage] = useState<string>('')
  const [selectedVoice, setSelectedVoice] = useState<string>('')

  const [message, setMessage] = useState('')
  const [currentSpeakingMessage, setCurrentSpeakingMessage] = useState('')

  const sendLipsyncMessage = useSendLipsyncMessage()

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

  const handleSessionIdChange = (newSessionId: string) => {
    setSessionId(newSessionId)
  }

  const handleSendMessage = () => {
    if (!message) return
    const messageToSend = message
    setCurrentSpeakingMessage(messageToSend)
    sendLipsyncMessage
      .mutateAsync({
        sessionId,
        voice: selectedVoice,
        text: messageToSend,
        model: selectedModel,
        speed: '1.0',
      })
      .then(() => {
        setMessage('')
      })
      .catch(() => {
        setCurrentSpeakingMessage('')
        toast.error('Failed to send message to avatar. Please try again.')
      })
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
      <div className="min-h-[500px] lg:col-span-3">
        <AvatarStream
          disabled={disabled || isLoading}
          onSessionIdChange={handleSessionIdChange}
          connectionStatus={connectionStatus}
          setConnectionStatus={setConnectionStatus}
          turnServerIp={turnServerIp}
        />

        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Send className="h-4 w-4" />
              Send Message to Avatar
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {/* Current Speaking Message */}
              {currentSpeakingMessage && (
                <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500"></div>
                    <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                      Avatar is speaking:
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-blue-600 dark:text-blue-400">
                    &ldquo;{currentSpeakingMessage}&rdquo;
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <div className="flex-1">
                  <Textarea
                    placeholder="Type your message here..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="min-h-[60px] resize-none border-slate-300 focus:border-blue-500 focus:ring-blue-500 dark:border-slate-600"
                    disabled={
                      disabled ||
                      isLoading ||
                      !(connectionStatus === 'connected')
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        if (
                          message.trim() &&
                          connectionStatus === 'connected'
                        ) {
                          handleSendMessage()
                        }
                      }
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  {sendLipsyncMessage.isPending ? (
                    <Button disabled size="default" className="h-[60px] w-14">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </Button>
                  ) : (
                    <Button
                      disabled={
                        !message.trim() ||
                        !(connectionStatus === 'connected') ||
                        disabled ||
                        isLoading
                      }
                      onClick={handleSendMessage}
                      size="default"
                      className="h-[60px] w-14 disabled:bg-slate-300"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Voice Settings Card - Takes 1 column */}
      <div className="lg:col-span-1">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mic className="h-5 w-5" />
              Voice Settings
            </CardTitle>
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
              <Select
                value={selectedLanguage}
                onValueChange={setSelectedLanguage}
                disabled={
                  disabled ||
                  sendLipsyncMessage.isPending ||
                  !availableLanguages.length
                }
              >
                <SelectTrigger id="language-select">
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  {availableLanguages.map((language) => (
                    <SelectItem key={language.id} value={language.id}>
                      {language.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Voice Selection */}
            <div>
              <label
                htmlFor="voice-select"
                className="mb-2 block text-sm font-medium"
              >
                Voice:
              </label>
              <Select
                value={selectedVoice}
                onValueChange={setSelectedVoice}
                disabled={
                  disabled ||
                  sendLipsyncMessage.isPending ||
                  !currentLanguageConfig
                }
              >
                <SelectTrigger id="voice-select">
                  <SelectValue placeholder="Select voice" />
                </SelectTrigger>
                <SelectContent>
                  {currentLanguageConfig?.voices.map((voice) => (
                    <SelectItem key={voice} value={voice}>
                      {voice}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
