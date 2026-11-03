// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  AlertCircle,
  AudioLines,
  Download,
  Loader,
  Volume2,
} from 'lucide-react'
import { EmptyState } from '@/components/common/empty-state'
import { InlineNotice } from '@/components/common/inline-notice'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { DemoLayout } from '@/services/common/demo/components/demo-layout'
import { DemoParameterSidebar } from '@/services/common/demo/components/demo-parameter-sidebar'
import { useDemoRuntime } from '@/services/common/demo/demo-runtime'
import {
  demoSessionKey,
  demoStateKey,
} from '@/services/common/demo/demo-session'
import {
  useSessionLeaveNotice,
  useSessionState,
} from '@/services/common/demo/session-store'
import type { Service } from '@/services/types'
import type { DemoParam } from '@/types/demo-params'
import { getEffectiveModel } from '@/types/service'
import { SpeechPlayer } from './components/speech-player'
import { DEFAULT_TTS_MODEL } from './config'
import { getVoicesForModel } from './lib/tts-models'
import { useTtsDemoParams } from './hooks/use-params'
import { useStreamedSpeech } from './hooks/use-streamed-speech'
import { useTtsVoiceStatus } from './hooks/use-voice-status'

const DEFAULT_TEXT =
  'Welcome to the Edge AI Demo Studio. This text is being converted to natural sounding speech by the selected text to speech model.'

/** Shown with the text before Synthesize; the rest stay in the parameter column. */
const VOICE_PARAM_IDS = new Set(['language', 'voice'])

/** Drops the select's "not cached" hint: the demo shows its own notice. */
function withoutHint(param: DemoParam): DemoParam {
  return param.type === 'select' ? { ...param, hint: undefined } : param
}

export function TextToSpeechDemo({ service }: { service: Service }) {
  const currentModel = getEffectiveModel(service).name || DEFAULT_TTS_MODEL
  const { available } = useDemoRuntime()
  const [input, setInput] = useSessionState(
    demoStateKey(service, 'tts:input'),
    DEFAULT_TEXT,
  )

  // WAV plays while synthesized, then the finished file takes over. Kept per instance.
  const speech = useStreamedSpeech(service.apiBase, {
    model: currentModel,
    session: service,
  })
  const { pending, result, failure } = speech
  const live = speech.playback !== 'idle'

  const { voiceMap, markDownloaded } = useTtsVoiceStatus(service.apiBase, {
    model: currentModel,
    enabled: available,
  })
  const { values: ttsValues, params } = useTtsDemoParams(
    currentModel,
    voiceMap,
    { sessionKey: demoStateKey(service, 'tts:params') },
  )

  // Speech cannot keep playing for an instance that is not shown.
  useSessionLeaveNotice(
    demoSessionKey(service),
    pending
      ? 'Switching instances stops the speech being synthesized.'
      : live
        ? 'Switching instances stops the speech playing.'
        : null,
  )

  const voiceParams = params
    .filter((p) => VOICE_PARAM_IDS.has(p.id))
    .map(withoutHint)
  const outputParams = params.filter((p) => !VOICE_PARAM_IDS.has(p.id))

  /** Not downloaded yet: its first synthesis waits for the download. */
  const isCold = (voice: string) =>
    Boolean(voice) && voiceMap?.[voice] === false
  const voiceLabel = (voice: string) =>
    getVoicesForModel(currentModel).find((v) => v.id === voice)?.label ?? voice

  const handleSynthesize = () => {
    if (!input.trim() || !available) return
    const voice = ttsValues.voice
    speech
      .synthesize({
        input: input.trim(),
        voice,
        speed: ttsValues.speed,
        responseFormat: ttsValues.format,
        volumeMultiplier: ttsValues.volume,
      })
      .then((file) => {
        // It has spoken, so it is downloaded now.
        if (file && voice) markDownloaded(voice)
      })
  }

  // Live playback always belongs to `latest`, and can outlast the request.
  const latest = pending ?? (failure ? null : result)
  // The last file, kept while a newer synthesis runs or after it failed.
  const previous = result && result !== latest ? result : null
  // Waiting for the voice to download, before any audio.
  const preparing = Boolean(pending && !live && isCold(pending.params.voice))

  return (
    <DemoLayout
      sidebar={
        outputParams.length > 0 && (
          <DemoParameterSidebar params={outputParams} />
        )
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <div className="space-y-2">
            <Label
              htmlFor="tts-text-input"
              className="text-foreground text-sm font-medium"
            >
              Text Input
            </Label>
            <Textarea
              id="tts-text-input"
              data-testid="tts-text-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Enter text to synthesize into speech..."
              rows={6}
              className="bg-muted/30 resize-none"
            />
            <p className="text-muted-foreground text-xs">
              {input.length} characters
            </p>
          </div>

          {voiceParams.length > 0 && (
            <div data-testid="tts-voice-settings">
              <DemoParameterSidebar params={voiceParams} variant="plain" />
            </div>
          )}

          {isCold(ttsValues.voice) && !preparing && (
            <InlineNotice
              tone="info"
              size="sm"
              role="note"
              data-testid="tts-voice-cold"
              icon={<Download aria-hidden className="h-4 w-4 shrink-0" />}
            >
              {voiceLabel(ttsValues.voice)} is not downloaded yet. The first
              synthesis with it downloads the voice before speaking, which can
              take a minute.
            </InlineNotice>
          )}

          <Button
            data-testid="tts-synthesize-button"
            onClick={handleSynthesize}
            disabled={!available || speech.isPending || !input.trim()}
            className="w-full gap-2"
          >
            {speech.isPending ? (
              <>
                <Loader aria-hidden className="h-4 w-4 animate-spin" />
                {preparing ? 'Preparing voice...' : 'Synthesizing...'}
              </>
            ) : (
              <>
                <Volume2 aria-hidden className="h-4 w-4" />
                Synthesize Speech
              </>
            )}
          </Button>
        </div>

        <section aria-labelledby="tts-output-heading" className="space-y-3">
          <h3
            id="tts-output-heading"
            className="text-foreground text-sm font-medium"
          >
            Audio Output
          </h3>
          <div className="border-border bg-muted/20 flex min-h-[200px] flex-col gap-3 rounded-xl border p-4">
            {!latest && !previous && !failure && (
              <EmptyState
                icon={AudioLines}
                size="sm"
                description="Synthesized audio will appear here..."
                className="flex-1 py-6"
              />
            )}

            {preparing && (
              <div
                role="status"
                data-testid="tts-preparing-voice"
                className="border-info/30 bg-info/5 flex items-start gap-2 rounded-lg border p-3"
              >
                <Download
                  aria-hidden="true"
                  className="text-info mt-0.5 h-4 w-4 shrink-0 animate-pulse"
                />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-foreground text-sm font-medium">
                    Preparing voice{' '}
                    {pending && voiceLabel(pending.params.voice)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Downloading it for first use. Synthesis starts once it is
                    ready; later requests with this voice skip this step.
                  </p>
                </div>
              </div>
            )}

            {pending && !live && !previous && !preparing && (
              <div
                role="status"
                className="flex flex-1 flex-col items-center justify-center gap-3"
              >
                <Loader
                  aria-hidden
                  className="text-primary h-8 w-8 animate-spin"
                />
                <p className="text-muted-foreground text-sm">
                  Generating audio...
                </p>
                <Progress
                  value={null}
                  aria-label="Generating audio"
                  className="h-1.5"
                />
              </div>
            )}

            {pending && !live && previous && !preparing && (
              <p
                role="status"
                className="text-foreground flex items-center gap-2 text-xs font-medium"
              >
                <Loader aria-hidden="true" className="h-3 w-3 animate-spin" />
                Synthesizing new speech...
              </p>
            )}

            {failure?.kind === 'error' && (
              <InlineNotice
                tone="destructive"
                size="sm"
                data-testid="tts-error"
                icon={<AlertCircle aria-hidden className="h-4 w-4 shrink-0" />}
              >
                {previous ? 'New speech failed: ' : ''}
                {failure.error.message}
              </InlineNotice>
            )}

            {failure?.kind === 'interrupted' && (
              <InlineNotice
                tone="info"
                size="sm"
                role="status"
                data-testid="tts-interrupted"
                icon={<AlertCircle aria-hidden className="h-4 w-4 shrink-0" />}
              >
                The last synthesis was stopped when you switched instances.
                Synthesize again to hear it.
              </InlineNotice>
            )}

            {latest && (!pending || live) && (
              <SpeechPlayer
                key={`latest-${latest.id}`}
                title={pending ? 'New speech' : 'Latest result'}
                request={latest}
                file={latest === result ? result.blob : null}
                live={
                  live
                    ? {
                        playing: speech.playback === 'playing',
                        pause: speech.pause,
                        resume: speech.resume,
                        position: speech.position,
                      }
                    : null
                }
                testId={
                  latest === result ? 'tts-audio-output' : 'tts-audio-streaming'
                }
              >
                {live && pending && (
                  <p className="text-muted-foreground flex items-center gap-2 text-xs">
                    <Loader
                      aria-hidden="true"
                      className="h-3 w-3 animate-spin"
                    />
                    Playing while the rest is synthesized...
                  </p>
                )}
              </SpeechPlayer>
            )}

            {previous && (
              <SpeechPlayer
                key={`previous-${previous.id}`}
                title="Previous result"
                request={previous}
                file={previous.blob}
                live={null}
                testId="tts-audio-previous"
              />
            )}
          </div>
        </section>
      </div>
    </DemoLayout>
  )
}
