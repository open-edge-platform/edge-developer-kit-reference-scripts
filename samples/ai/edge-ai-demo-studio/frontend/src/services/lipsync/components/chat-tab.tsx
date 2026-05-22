// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Send,
  Volume2,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  useGetService,
  useServiceStatus,
} from '@/context/service-status-context'
import { useTtsVoiceStatus } from '@/services/text-to-speech/hooks/use-voice-status'
import { useLipsyncChat } from '../hooks'

export interface ChatTabProps {
  sessionId: string | null
}

export function ChatTab({ sessionId }: ChatTabProps) {
  const [chatText, setChatText] = useState('Hello, welcome to the demo!')
  const [voice, setVoice] = useState('af_heart')
  const [speed, setSpeed] = useState('1.0')

  const chatMutation = useLipsyncChat()

  const { statusMap, startService, isActionPending } = useServiceStatus()
  const ttsStatus = statusMap['text-to-speech'] ?? 'offline'
  const isTtsOnline = ttsStatus === 'online'
  const ttsService = useGetService('text-to-speech')
  const { isVoiceDownloaded } = useTtsVoiceStatus()

  const isConnected = sessionId !== null

  const sendChat = useCallback(() => {
    if (!sessionId || !chatText.trim()) return
    const text = chatText.trim()
    const ttsUrl = ttsService
      ? `http://localhost:${ttsService.port}/v1`
      : undefined
    chatMutation.mutate(
      {
        session_id: sessionId,
        chat_type: 'echo',
        text,
        voice,
        speed,
        tts_url: ttsUrl,
      },
      {
        onSuccess: () => {
          setChatText('')
          toast.success('Message sent to avatar')
        },
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : 'Failed to send chat'),
      },
    )
  }, [sessionId, chatText, voice, speed, chatMutation, ttsService])

  if (!isTtsOnline) {
    return (
      <div className="border-border bg-muted/10 flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center">
        <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-full">
          <Volume2 className="text-muted-foreground h-5 w-5" />
        </div>
        <div>
          <p className="text-foreground text-sm font-medium">
            Text-to-Speech service required
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            Chat uses TTS to convert your text into speech for the avatar.
            Enable the Text-to-Speech service to use this feature.
          </p>
        </div>
        <Button
          size="sm"
          className="bg-primary hover:bg-primary-light mt-1 text-white"
          disabled={
            isActionPending('text-to-speech') || ttsStatus === 'starting'
          }
          onClick={() => startService('text-to-speech')}
        >
          {ttsStatus === 'starting' || isActionPending('text-to-speech') ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Volume2 className="mr-1.5 h-3.5 w-3.5" />
          )}
          {ttsStatus === 'starting' ? 'Starting...' : 'Start Text-to-Speech'}
        </Button>
      </div>
    )
  }

  return (
    <>
      <p className="text-muted-foreground text-xs">
        Type text for the avatar to speak aloud.
      </p>
      <div className="space-y-2">
        <Textarea
          value={chatText}
          onChange={(e) => setChatText(e.target.value)}
          placeholder="Type text for the avatar to speak..."
          className="bg-muted/30 min-h-[72px] resize-none text-sm"
          disabled={!isConnected}
          maxLength={500}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              sendChat()
            }
          }}
        />
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-xs">
            Enter to send · Shift+Enter for new line
          </p>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">
              {chatText.length}/500
            </span>
            <Button
              onClick={sendChat}
              disabled={
                chatMutation.isPending || !isConnected || !chatText.trim()
              }
              size="sm"
              className="bg-primary hover:bg-primary-light text-white"
            >
              {chatMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-3.5 w-3.5" />
              )}
              Send
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="voice-select" className="text-xs">
            Voice
          </Label>
          <Select value={voice} onValueChange={setVoice}>
            <SelectTrigger id="voice-select" className="text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                { value: 'af_heart', label: 'English (af_heart)' },
                { value: 'zf_xiaoxiao', label: 'Chinese (zf_xiaoxiao)' },
                { value: 'jf_nezumi', label: 'Japanese (jf_nezumi)' },
              ].map((v) => (
                <SelectItem key={v.value} value={v.value} className="text-xs">
                  <span className="flex items-center gap-1.5">
                    {isTtsOnline &&
                      (isVoiceDownloaded(v.value) ? (
                        <CheckCircle2 className="text-success h-3 w-3 shrink-0" />
                      ) : (
                        <Download className="text-muted-foreground h-3 w-3 shrink-0" />
                      ))}
                    {v.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isTtsOnline && !isVoiceDownloaded(voice) && (
            <p className="text-warning flex items-center gap-1 text-[10px]">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              Voice not cached — first run may be slow
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="speed-select" className="text-xs">
            Speed
          </Label>
          <Select value={speed} onValueChange={setSpeed}>
            <SelectTrigger id="speed-select" className="text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0.5" className="text-xs">
                0.5x
              </SelectItem>
              <SelectItem value="0.75" className="text-xs">
                0.75x
              </SelectItem>
              <SelectItem value="1.0" className="text-xs">
                1.0x (Normal)
              </SelectItem>
              <SelectItem value="1.25" className="text-xs">
                1.25x
              </SelectItem>
              <SelectItem value="1.5" className="text-xs">
                1.5x
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {!isConnected && (
        <p className="text-muted-foreground text-xs">
          Connect to the avatar stream to enable chat.
        </p>
      )}
    </>
  )
}
