// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader,
  Send,
  Volume2,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ServiceLink } from '@/components/common/service-link'
import { EmptyState } from '@/components/common/empty-state'
import { TruncatedText } from '@/components/common/truncated-text'
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
  useServiceActivity,
  useServiceStatus,
} from '@/context/service-status-context'
import { siblingWorkerAddress } from '@/lib/instances/instances'
import { toastError } from '@/lib/browser/toast-error'
import { DEFAULT_TTS_MODEL } from '@/services/text-to-speech/config'
import { getVoicesForModel } from '@/services/text-to-speech/lib/tts-models'
import { getEffectiveModel } from '@/types/service'
import { useTtsVoiceStatus } from '@/services/text-to-speech/hooks/use-voice-status'
import { useLipsyncChat } from '../hooks'
import { FrameGenerationSwitch } from './frame-generation-switch'

const SPEED_OPTIONS = [
  { value: '0.5', label: '0.5x' },
  { value: '0.75', label: '0.75x' },
  { value: '1.0', label: '1.0x (Normal)' },
  { value: '1.25', label: '1.25x' },
  { value: '1.5', label: '1.5x' },
]

export interface ChatTabProps {
  sessionId: string | null
  frameGeneration: boolean
  onFrameGenerationChange: (checked: boolean) => void
  apiBase: string | undefined
}

export function ChatTab({
  sessionId,
  frameGeneration,
  onFrameGenerationChange,
  apiBase,
}: ChatTabProps) {
  const [chatText, setChatText] = useState('Hello, welcome to the demo!')
  const [speed, setSpeed] = useState('1.0')

  const { mutate: chatMutate, isPending: isChatPending } =
    useLipsyncChat(apiBase)

  const { startService } = useServiceStatus()
  const { isActionPending } = useServiceActivity()
  const ttsService = useGetService('text-to-speech')
  const ttsStatus = ttsService?.status ?? 'offline'
  const isTtsOnline = ttsStatus === 'online'
  const currentModel =
    (ttsService && getEffectiveModel(ttsService).name) || DEFAULT_TTS_MODEL
  const voiceOptions = getVoicesForModel(currentModel).map((v) => ({
    value: v.id,
    label: `${v.language} (${v.label})`,
  }))
  const [voice, setVoice] = useState(() => voiceOptions[0]?.value ?? '')

  const [prevModel, setPrevModel] = useState(currentModel)
  if (prevModel !== currentModel) {
    setPrevModel(currentModel)
    setVoice(voiceOptions[0]?.value ?? '')
  } else if (voice && !voiceOptions.some((v) => v.value === voice)) {
    setVoice(voiceOptions[0]?.value ?? '')
  }

  const { isVoiceDownloaded } = useTtsVoiceStatus(ttsService?.apiBase, {
    enabled: isTtsOnline,
  })

  const isConnected = sessionId !== null

  const sendChat = () => {
    if (!sessionId || !chatText.trim()) return
    const text = chatText.trim()
    const ttsUrl = ttsService?.instanceKey
      ? siblingWorkerAddress(ttsService.instanceKey)
      : undefined
    chatMutate(
      {
        session_id: sessionId,
        chat_type: 'echo',
        text,
        voice,
        speed,
        tts_url: ttsUrl,
        frame_generation: frameGeneration,
      },
      {
        onSuccess: () => {
          setChatText('')
          toast.success('Message sent to avatar')
        },
        onError: toastError('Failed to send chat'),
      },
    )
  }

  // Chat needs a Text to Speech instance; none was added yet.
  if (!ttsService?.added) {
    return (
      <EmptyState
        icon={Volume2}
        title="Text to Speech required"
        description="Chat turns your text into speech with the Text to Speech service before the avatar lip-syncs it. Add a Text to Speech instance to use Chat; Audio works without it."
        className="py-10"
      >
        <Button size="sm" className="mt-4" asChild>
          <ServiceLink serviceType="text-to-speech">
            <Volume2 aria-hidden="true" className="h-3.5 w-3.5" />
            Add Text to Speech
          </ServiceLink>
        </Button>
      </EmptyState>
    )
  }

  if (!isTtsOnline) {
    const isStarting =
      ttsStatus === 'starting' || isActionPending('text-to-speech')
    return (
      <EmptyState
        icon={Volume2}
        title="Text to Speech is not running"
        description={`Chat voices your text with ${ttsService.label ?? 'Text to Speech'}, which is stopped. Start it to use Chat; Audio works without it.`}
        className="py-10"
      >
        <Button
          size="sm"
          className="mt-4"
          disabled={isStarting}
          onClick={() => startService('text-to-speech')}
        >
          {isStarting ? (
            <Loader aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Volume2 aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          {isStarting
            ? 'Starting…'
            : `Start ${ttsService.label ?? 'Text to Speech'}`}
        </Button>
      </EmptyState>
    )
  }

  return (
    <>
      <p
        className="text-muted-foreground flex min-w-0 flex-wrap items-baseline gap-x-1 text-xs"
        data-testid="lipsync-chat-voice"
      >
        <span>Type text for the avatar to speak. Voiced by</span>
        <TruncatedText
          text={ttsService.label ?? 'Text to Speech'}
          className="text-foreground max-w-48"
        />
        <span>(Text to Speech).</span>
      </p>
      <div className="space-y-2">
        <Label htmlFor="lipsync-chat-text" className="sr-only">
          Text for the avatar to speak
        </Label>
        <Textarea
          id="lipsync-chat-text"
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
              disabled={isChatPending || !isConnected || !chatText.trim()}
              size="sm"
            >
              {isChatPending ? (
                <Loader className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-3.5 w-3.5" />
              )}
              Send
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="min-w-0 flex-[2_1_14rem] space-y-1.5">
          <Label htmlFor="voice-select" className="text-xs">
            Voice
          </Label>
          <Select value={voice} onValueChange={setVoice}>
            <SelectTrigger id="voice-select" className="w-full min-w-0 text-xs">
              <SelectValue className="min-w-0 flex-1 text-left" />
            </SelectTrigger>
            <SelectContent>
              {voiceOptions.map((v) => (
                <SelectItem key={v.value} value={v.value} className="text-xs">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {isVoiceDownloaded(v.value) ? (
                      <CheckCircle2
                        aria-label="Downloaded"
                        className="text-success h-3 w-3 shrink-0"
                      />
                    ) : (
                      <Download
                        aria-label="Not downloaded"
                        className="text-muted-foreground h-3 w-3 shrink-0"
                      />
                    )}
                    <span className="truncate">{v.label}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!isVoiceDownloaded(voice) && (
            <p className="text-warning-strong flex items-center gap-1 text-xs">
              <AlertTriangle aria-hidden="true" className="h-3 w-3 shrink-0" />
              Voice not cached — first run may be slow
            </p>
          )}
        </div>
        <div className="min-w-0 flex-[1_1_8rem] space-y-1.5">
          <Label htmlFor="speed-select" className="text-xs">
            Speed
          </Label>
          <Select value={speed} onValueChange={setSpeed}>
            <SelectTrigger id="speed-select" className="w-full min-w-0 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SPEED_OPTIONS.map((opt) => (
                <SelectItem
                  key={opt.value}
                  value={opt.value}
                  className="text-xs"
                >
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <FrameGenerationSwitch
        checked={frameGeneration}
        onCheckedChange={onFrameGenerationChange}
      />

      {!isConnected && (
        <p className="text-muted-foreground text-xs">
          Connect to the avatar stream to enable chat.
        </p>
      )}
    </>
  )
}
