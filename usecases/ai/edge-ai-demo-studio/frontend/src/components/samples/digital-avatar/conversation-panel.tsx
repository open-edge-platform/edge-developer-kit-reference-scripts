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
import { Textarea } from '@/components/ui/textarea'
import { useStopAvatar } from '@/hooks/use-lipsync'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import {
  Bot,
  Loader2,
  Send,
  User,
  MessageCircle,
  Square,
  Languages,
  Mic,
} from 'lucide-react'
import { useEffect, useRef, useState, useMemo } from 'react'
import { toast } from 'sonner'
import { TTS_MODELS } from '@/lib/workloads/text-to-speech'
import { useGetVoices } from '@/hooks/use-tts'
import {
  SelectLanguage,
  SelectVoice,
} from '@/components/workloads/text-to-speech/common'

interface ConversationPanelProps {
  sessionId: string
  connectionStatus: string
  disabled: boolean
  knowledgeBaseId?: number
  selectedModel?: string
}

export function ConversationPanel({
  sessionId,
  connectionStatus,
  disabled,
  knowledgeBaseId,
  selectedModel,
}: ConversationPanelProps) {
  const chatEndRef = useRef<HTMLDivElement>(null)
  const [currentMessage, setCurrentMessage] = useState('')
  const [selectedLanguage, setSelectedLanguage] = useState<string>('')
  const [selectedVoice, setSelectedVoice] = useState<string>('')
  const { data: availableVoices, refetch: refetchVoices } = useGetVoices()

  const { messages, sendMessage, status, stop } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/lipsync_chat',
    }),
  })
  const stopAvatar = useStopAvatar()

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

  // Initialize default selections when component mounts or model changes
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

  const handleSendMessage = () => {
    if (!currentMessage) return
    sendMessage(
      { text: currentMessage },
      {
        body: {
          sessionId,
          language: selectedLanguage || 'English',
          knowledgeBaseId,
          voice: selectedVoice,
          ttsModel: selectedModel,
        },
      },
    ).then(() => {
      if (availableVoices?.[selectedVoice] != true) {
        refetchVoices()
      }
    })
    setCurrentMessage('')
  }

  const handleStopChat = () => {
    stop()
    stopAvatar.mutate({ sessionId })
    toast.info('Chat generation stopped')
  }

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (
        currentMessage.trim() &&
        connectionStatus === 'connected' &&
        status === 'ready'
      ) {
        handleSendMessage()
      }
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-blue-500" />
          Conversation
        </CardTitle>
        <CardDescription>
          Chat with your digital avatar in multiple languages
        </CardDescription>
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
              disabled={disabled || connectionStatus !== 'connected'}
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
              disabled={
                disabled ||
                connectionStatus !== 'connected' ||
                !currentLanguageConfig
              }
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
            {messages.map((message) => (
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
                    <p className="whitespace-pre-wrap">
                      {message.parts.map((part, index) =>
                        part.type === 'text' ? (
                          <span key={index}>{part.text.trimStart()}</span>
                        ) : null,
                      )}
                    </p>
                  </div>
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
        </ScrollArea>

        {/* Message Input */}
        <div className="space-y-3">
          <div className="flex gap-2">
            <Textarea
              placeholder="Ask me anything or start a conversation..."
              value={currentMessage}
              onChange={(e) => setCurrentMessage(e.target.value)}
              onKeyDown={handleKeyPress}
              className="h-[80px] max-h-[80px] resize-none overflow-y-auto"
              disabled={connectionStatus !== 'connected' || status !== 'ready'}
            />
            <div className="flex flex-col gap-2">
              {status === 'streaming' ? (
                <Button
                  onClick={handleStopChat}
                  variant="destructive"
                  size="icon"
                  className="h-[80px] w-12"
                  disabled={disabled}
                >
                  <Square className="h-4 w-4" />
                </Button>
              ) : status !== 'ready' ? (
                <Button disabled size="icon" className="h-[80px] w-12">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </Button>
              ) : (
                <Button
                  disabled={
                    !currentMessage.trim() || connectionStatus !== 'connected'
                  }
                  onClick={handleSendMessage}
                  className="h-[80px] w-12"
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
