// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { Bot, Send, User, Square, Loader2, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
interface ChatPanelProps {
  disabled: boolean
  knowledgeBaseId?: number
  selectedModel?: string
}

export function ChatPanel({
  disabled,
  knowledgeBaseId,
  selectedModel,
}: ChatPanelProps) {
  const chatEndRef = useRef<HTMLDivElement>(null)
  const [currentMessage, setCurrentMessage] = useState('')

  const { messages, sendMessage, status, stop, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat/rag',
    }),
  })

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  const handleSendMessage = () => {
    if (!currentMessage.trim()) return
    sendMessage(
      { text: currentMessage },
      {
        body: {
          knowledgeBaseId,
          model: selectedModel,
        },
      },
    )
    setCurrentMessage('')
  }

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (currentMessage.trim() && !disabled && status === 'ready') {
        handleSendMessage()
      }
    }
  }

  const handleStopChat = () => {
    stop()
  }

  const handleClearChat = () => {
    handleStopChat() // Stop any ongoing generation
    setMessages([])
  }

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
      {/* Chat Messages */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full px-6 py-4">
          <div className="mx-auto max-w-3xl space-y-6">
            {messages.length === 0 && (
              <div className="flex h-full min-h-[400px] items-center justify-center text-center">
                <div className="space-y-4">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg">
                    <Bot className="h-8 w-8 text-white" />
                  </div>
                  <div>
                    <p className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                      Start a conversation!
                    </p>
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                      {knowledgeBaseId
                        ? 'Ask questions based on your knowledge base'
                        : 'Chat with the AI assistant'}
                    </p>
                  </div>
                </div>
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
                  className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full shadow-sm ${
                    message.role === 'user'
                      ? 'bg-gradient-to-br from-blue-500 to-blue-600'
                      : 'bg-gradient-to-br from-green-400 to-emerald-500 dark:from-green-600 dark:to-emerald-600'
                  }`}
                >
                  {message.role === 'user' ? (
                    <User className="h-5 w-5 text-white" />
                  ) : (
                    <Bot className="h-5 w-5 text-white" />
                  )}
                </div>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 shadow-sm ${
                    message.role === 'user'
                      ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
                  }`}
                >
                  <div className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed sm:text-sm">
                    <Markdown remarkPlugins={[remarkGfm]}>
                      {message.parts
                        .filter((part) => part.type === 'text')
                        .map((part) => part.text)
                        .join('')}
                    </Markdown>
                  </div>
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
        </ScrollArea>
      </div>

      {/* Message Input */}
      <div className="border-t border-slate-200 bg-white px-6 py-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="mx-auto max-w-3xl">
          <div className="flex gap-3">
            <Textarea
              placeholder="Type your message here... (Press Enter to send, Shift+Enter for new line)"
              value={currentMessage}
              onChange={(e) => setCurrentMessage(e.target.value)}
              onKeyDown={handleKeyPress}
              className="max-h-[120px] min-h-[56px] resize-none rounded-xl border-slate-300 bg-slate-50 px-4 py-3 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-800"
              disabled={disabled || status !== 'ready'}
            />
            <div className="flex flex-row gap-2">
              {status === 'streaming' ? (
                <Button
                  type="button"
                  onClick={handleStopChat}
                  variant="destructive"
                  size="icon"
                  className="h-[56px] w-14 rounded-xl shadow-sm"
                  disabled={disabled}
                >
                  <Square className="h-5 w-5" />
                </Button>
              ) : status !== 'ready' ? (
                <Button
                  disabled
                  size="icon"
                  className="h-[56px] w-14 rounded-xl"
                >
                  <Loader2 className="h-5 w-5 animate-spin" />
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={!currentMessage.trim() || disabled}
                  onClick={handleSendMessage}
                  className="h-[56px] w-14 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-sm hover:from-blue-600 hover:to-blue-700"
                >
                  <Send className="h-5 w-5" />
                </Button>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline-destructive"
                    size="icon"
                    onClick={handleClearChat}
                    hidden={messages.length === 0}
                    className="h-[56px] w-14 rounded-xl"
                  >
                    <Trash2 className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" align="center">
                  <p className="text-sm">Clear chat history</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
