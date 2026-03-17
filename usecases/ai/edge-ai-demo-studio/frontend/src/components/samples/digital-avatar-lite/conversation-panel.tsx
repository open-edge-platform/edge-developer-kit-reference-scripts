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
import { ScrollArea } from '@/components/ui/scroll-area'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { Bot, User, MessageCircle, Languages, Mic, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, useMemo } from 'react'
import { toast } from 'sonner'
import { TTS_MODELS } from '@/lib/workloads/text-to-speech'
import { useGetVoices } from '@/hooks/use-tts'
import {
  SelectLanguage,
  SelectVoice,
} from '@/components/workloads/text-to-speech/common'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useAudioQueue } from '@/hooks/use-audio-queue'
import { useUpdateAvatarState } from '@/hooks/use-avatar'
import { InputArea } from '@/components/common/input-area'

interface ConversationPanelProps {
  disabled: boolean
  useWakeWordDetection: boolean
  isSTTEnabled: boolean
  isDenoiseEnabled: boolean
  knowledgeBaseId?: number
  selectedModel?: string
  useMcpTools?: boolean
}

export function ConversationPanel({
  disabled,
  useWakeWordDetection,
  isSTTEnabled,
  isDenoiseEnabled,
  knowledgeBaseId,
  selectedModel,
  useMcpTools,
}: ConversationPanelProps) {
  const chatEndRef = useRef<HTMLDivElement>(null)
  const [selectedLanguage, setSelectedLanguage] = useState<string>('')
  const [selectedVoice, setSelectedVoice] = useState<string>('')
  const [resetId, setResetId] = useState<number>(0)
  const { data: availableVoices, refetch: refetchVoices } = useGetVoices({
    enabled: !disabled,
  })

  const { mutate: updateAvatarState } = useUpdateAvatarState()
  const audioQueue = useAudioQueue()

  // Refs
  const hasLoggedAudioStartRef = useRef(false)

  const { messages, sendMessage, status, stop, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat/digital-avatar-lite',
    }),
    onData: (data) => {
      if (data.type === 'data-new-sentence') {
        audioQueue.addTextToQueue(
          (
            data as {
              data: { sentence: string }
              id: string
              type: 'data-new-sentence'
            }
          ).data.sentence,
        )
      }
    },
  })

  // Get the current model configuration
  const currentModelConfig = useMemo(() => {
    return TTS_MODELS.find((model) => model.model === selectedModel)
  }, [selectedModel])

  // Get available languages for the selected model
  const availableLanguages = useMemo(
    () => currentModelConfig?.languages || [],
    [currentModelConfig],
  )

  // Get available voices for the selected language
  const currentLanguageConfig = useMemo(() => {
    return availableLanguages.find((lang) => lang.id === selectedLanguage)
  }, [availableLanguages, selectedLanguage])

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

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  const [prevModel, setPrevModel] = useState<string | undefined>(undefined)
  if (selectedModel !== prevModel) {
    setPrevModel(selectedModel)
    const modelConfig = TTS_MODELS.find(
      (model) => model.model === selectedModel,
    )
    if (modelConfig && modelConfig.languages.length > 0) {
      const firstLanguage = modelConfig.languages[0]
      setSelectedLanguage(firstLanguage.id)
      setSelectedVoice(firstLanguage.voices[0] || '')
    }
  }

  const [prevLang, setPrevLang] = useState(selectedLanguage)
  if (selectedLanguage !== prevLang) {
    setPrevLang(selectedLanguage)
    const languageConfig = availableLanguages.find(
      (lang) => lang.id === selectedLanguage,
    )
    if (languageConfig && languageConfig.voices.length > 0) {
      setSelectedVoice(languageConfig.voices[0])
    }
  }

  const handleSendMessage = (
    text: string,
    isWakeWordDetected: boolean = false,
  ) => {
    if (!text) return
    sendMessage(
      { text: text, metadata: { isWakeWordDetected } },
      {
        body: {
          language: selectedLanguage || 'English',
          knowledgeBaseId,
          useMcpTools: useMcpTools || false,
        },
      },
    ).then(() => {
      if (availableVoices?.[selectedVoice] != true) {
        refetchVoices()
      }
    })
  }

  // Log when text streaming is done and all audio is finished playing
  useEffect(() => {
    if (
      status !== 'streaming' &&
      !audioQueue.isPlaying &&
      audioQueue.queueLength === 0 &&
      !audioQueue.isGenerating &&
      hasLoggedAudioStartRef.current
    ) {
      // Reset the flag for the next message
      hasLoggedAudioStartRef.current = false
      updateAvatarState({ state: 'idle' })
    }
  }, [
    status,
    audioQueue.isPlaying,
    audioQueue.queueLength,
    audioQueue.isGenerating,
    updateAvatarState,
  ])

  // Log when audio playback starts
  useEffect(() => {
    if (
      audioQueue.isPlaying &&
      audioQueue.currentAudio &&
      !hasLoggedAudioStartRef.current
    ) {
      hasLoggedAudioStartRef.current = true
      if (audioQueue.currentAudio.type === 'greeting')
        updateAvatarState({ state: 'waving' })
      else updateAvatarState({ state: 'talking' })
    }
  }, [audioQueue.isPlaying, audioQueue.currentAudio, updateAvatarState])

  const handleStopChat = () => {
    stop()
    // Clear audio queue and stop playback
    audioQueue.clearQueue()
    // Reset the flag
    hasLoggedAudioStartRef.current = false
    // Update avatar state to idle
    updateAvatarState({ state: 'idle' })
    toast.info('Response stopped')
  }

  const handleClearChat = () => {
    handleStopChat() // Stop any ongoing generation
    setMessages([])
    setResetId((prev) => prev + 1)
    toast.success('Chat history cleared')
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-blue-500" />
              Conversation
            </CardTitle>
            <CardDescription>
              Chat with your digital avatar in multiple languages
            </CardDescription>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline-destructive"
                size="sm"
                onClick={handleClearChat}
                hidden={messages.length === 0}
                className="flex items-center gap-2"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="center">
              <p className="text-sm">Clear chat history</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Language and Voice Settings */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Language Selection */}
          <div className="space-y-2">
            <label
              htmlFor="language-select"
              className="flex items-center text-sm font-medium"
            >
              <Languages className="mr-1 h-4 w-4" />
              Language
            </label>
            <SelectLanguage
              selectedLanguage={selectedLanguage}
              setSelectedLanguage={setSelectedLanguage}
              availableLanguages={availableLanguages}
              disabled={disabled}
            />
          </div>

          {/* Voice Selection */}
          <div className="space-y-2">
            <label
              htmlFor="voice-select"
              className="flex items-center text-sm font-medium"
            >
              <Mic className="mr-1 h-4 w-4" />
              Voice
            </label>
            <SelectVoice
              selectedVoice={selectedVoice}
              setSelectedVoice={setSelectedVoice}
              groupedVoices={groupedVoices}
              disabled={disabled || !currentLanguageConfig}
            />
          </div>
        </div>

        {/* Chat Messages */}
        <ScrollArea className="h-80 w-full rounded-lg border bg-slate-50 p-4 dark:bg-slate-900">
          <div className="w-full space-y-4">
            {messages.length === 0 && (
              <div className="text-center text-slate-500 dark:text-slate-400">
                <Bot className="mx-auto mb-2 h-8 w-8 opacity-50" />
                <p className="text-sm">
                  Start a conversation with your avatar!
                </p>
              </div>
            )}
            {messages.map(
              (message) =>
                !(message.metadata as { isWakeWordDetected?: boolean })
                  ?.isWakeWordDetected && (
                  <div
                    key={message.id}
                    className={`flex items-start gap-3 ${
                      message.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
                        message.role === 'user'
                          ? 'bg-blue-600 text-white'
                          : 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                      }`}
                    >
                      {message.role === 'user' ? (
                        <User className="h-4 w-4" />
                      ) : (
                        <Bot className="h-4 w-4" />
                      )}
                    </div>
                    <div
                      className={`max-w-[calc(100%-3rem)] flex-1 rounded-lg px-4 py-2 text-sm break-words ${
                        message.role === 'user'
                          ? 'ml-12 bg-blue-600 text-white'
                          : 'mr-12 bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="whitespace-pre-wrap">
                          <Markdown remarkPlugins={[remarkGfm]}>
                            {message.parts
                              .filter((part) => part.type === 'text')
                              .map((part) => part.text)
                              .join('')}
                          </Markdown>
                        </div>
                      </div>
                    </div>
                  </div>
                ),
            )}
            <div ref={chatEndRef} />
          </div>
        </ScrollArea>

        <InputArea
          disabled={disabled}
          resetId={resetId}
          useWakeWordDetection={useWakeWordDetection}
          isSTTEnabled={isSTTEnabled}
          isDenoiseEnabled={isDenoiseEnabled}
          sttLanguage={selectedLanguage.slice(0, 2)}
          sendMessage={handleSendMessage}
          onStop={handleStopChat}
          isStreaming={status === 'streaming'}
          isReady={status === 'ready'}
          isPlayingAudio={audioQueue.isPlaying}
          isGeneratingAudio={audioQueue.isGenerating}
        />
      </CardContent>
    </Card>
  )
}
