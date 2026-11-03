// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  AudioLines,
  Bell,
  Loader,
  Mic,
  MicOff,
  RefreshCw,
  X,
} from 'lucide-react'
import { useEffect, useEffectEvent } from 'react'
import { useOpenConfigure } from '@/components/configure/configure-opener'
import { EmptyState } from '@/components/common/empty-state'
import { InlineNotice } from '@/components/common/inline-notice'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { STATE_LABEL } from '@/lib/instances/service-presentation'
import { cn } from '@/lib/utils'
import { DemoLayout } from '@/services/common/demo/components/demo-layout'
import { DemoParameterSidebar } from '@/services/common/demo/components/demo-parameter-sidebar'
import { demoStateKey } from '@/services/common/demo/demo-session'
import type { Service } from '@/services/types'
import { getEffectiveModel } from '@/types/service'
import { MicVisualization } from './components/mic-visualization'
import { ModelEventCard } from './components/model-event-card'
import { WebhookSubscribers } from './components/webhook-subscribers'
import {
  useStartDetection,
  useStopDetection,
} from './hooks/use-detection-control'
import {
  useAudioLevel,
  useDetectionEvents,
  useDetectionFlash,
} from './hooks/use-detection-stream'
import { DEFAULT_DEVICE, useWakeWordParams } from './hooks/use-params'
import {
  useWakeWordDevices,
  useWakeWordHealth,
  useWakeWordModels,
} from './hooks/use-wake-word-queries'
import { stopDetection, wakeWordKey } from './lib/api'
import type { DetectionEvent } from './lib/detection-stream'
import { parseModelNames, wakeWordLabel } from './lib/model-names'

function groupByModel(events: DetectionEvent[]) {
  const byModel = new Map<string, DetectionEvent[]>()
  for (const event of events) {
    const group = byModel.get(event.model) ?? []
    group.push(event)
    byModel.set(event.model, group)
  }
  return byModel
}

/** One labelled state, in words: the service's, or detection's. */
function StateRow({
  label,
  value,
  active,
  testId,
}: {
  label: string
  value: string
  active: boolean
  testId: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      <dt className="text-muted-foreground">{label}:</dt>
      <dd
        className="text-foreground flex items-center gap-1.5 font-medium"
        data-testid={testId}
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-block h-2 w-2 rounded-full',
            active ? 'bg-success' : 'bg-muted-foreground/40',
          )}
        />
        {value}
      </dd>
    </div>
  )
}

export function WakeWordDetectionDemo({ service }: { service: Service }) {
  const { apiBase } = service
  const queryClient = useQueryClient()
  const openConfigure = useOpenConfigure()

  const health = useWakeWordHealth(apiBase).data ?? null
  const devicesQuery = useWakeWordDevices(apiBase)
  const modelsQuery = useWakeWordModels(apiBase)
  const startDetection = useStartDetection(apiBase)
  const stop = useStopDetection(apiBase)

  const isDetecting = health?.detection_active ?? false
  const loadedModels = modelsQuery.data?.loadedModels ?? health?.models ?? []
  // What the worker listens for; before it reports, what the instance is
  // configured with.
  const wakeWords =
    loadedModels.length > 0
      ? loadedModels
      : parseModelNames(getEffectiveModel(service).name)

  const {
    values: paramValues,
    params,
    deviceOptions,
    setDeviceId,
  } = useWakeWordParams(devicesQuery.data?.devices ?? [], {
    sessionKey: demoStateKey(service, 'wakeword:params'),
  })
  // A saved microphone missing from the list (unplugged, or the list not
  // loaded yet) shows as the default, and Start sends what is shown.
  const microphone =
    deviceOptions.find((o) => o.value === paramValues.deviceId) ??
    deviceOptions[0]
  const devicesLoaded = !devicesQuery.isPending

  const { events, clearEvents } = useDetectionEvents(apiBase, isDetecting)
  const { level: audioLevel } = useAudioLevel(apiBase, isDetecting)
  const flash = useDetectionFlash(apiBase, isDetecting)

  // Leaving the demo stops the detection it was showing.
  const stopOnLeave = useEffectEvent(() => {
    if (isDetecting && apiBase) stopDetection(apiBase).catch(() => {})
  })
  useEffect(() => () => stopOnLeave(), [])

  const isStarting = startDetection.isPending
  const isStopping = stop.isPending && isDetecting
  const error = startDetection.error?.message ?? stop.error?.message ?? null

  const handleStart = () => {
    startDetection.mutate({
      deviceId:
        microphone.value !== DEFAULT_DEVICE ? Number(microphone.value) : null,
      threshold: paramValues.detectionThreshold,
    })
  }

  const eventsByModel = groupByModel(events)
  const prompt = isDetecting
    ? flash
      ? `Detected: ${wakeWordLabel(flash.model)}`
      : `Listening on ${microphone.label}. Say a wake word.`
    : 'Not listening. Start detection to open the microphone.'

  return (
    <DemoLayout
      sidebar={
        <DemoParameterSidebar params={params}>
          <WebhookSubscribers apiBase={apiBase} />
        </DemoParameterSidebar>
      }
    >
      {error && (
        <InlineNotice
          tone="destructive"
          size="sm"
          icon={<AlertCircle aria-hidden className="h-4 w-4 shrink-0" />}
        >
          {error}
        </InlineNotice>
      )}

      <section
        aria-labelledby="wwd-control-heading"
        className="border-border bg-card flex flex-col rounded-xl border p-4 sm:p-6"
      >
        <h3
          id="wwd-control-heading"
          className="text-foreground flex items-center gap-2 text-sm font-medium"
        >
          <AudioLines aria-hidden className="h-4 w-4" />
          Detection
        </h3>

        {/* Two states: a running service listens only once detection is started. */}
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <StateRow
            label="Service"
            value={STATE_LABEL[service.status]}
            active={service.status === 'online'}
            testId="wwd-service-state"
          />
          <StateRow
            label="Detection"
            value={isDetecting ? 'Listening' : 'Not listening'}
            active={isDetecting}
            testId="wwd-detection-state"
          />
        </dl>

        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-6">
          <MicVisualization
            isDetecting={isDetecting}
            audioLevel={audioLevel}
            detected={flash !== null}
          />

          <p
            role="status"
            className="text-muted-foreground text-center text-sm"
          >
            {prompt}
          </p>
        </div>

        <div
          className="border-border space-y-3 border-t pt-4"
          data-testid="wwd-detection-setup"
        >
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p
                className="text-muted-foreground text-xs"
                id="wwd-wake-words-label"
              >
                Wake words
              </p>
              {openConfigure && (
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  className="h-auto p-0 text-xs"
                  onClick={openConfigure}
                >
                  Change in Configure
                </Button>
              )}
            </div>
            {wakeWords.length > 0 ? (
              <ul
                aria-labelledby="wwd-wake-words-label"
                className="flex flex-wrap gap-1.5"
                data-testid="wwd-wake-words"
              >
                {wakeWords.map((model) => (
                  <li key={model}>
                    <Badge variant="secondary" className="text-xs">
                      {wakeWordLabel(model)}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-foreground text-xs">
                No wake word is loaded. Choose wake words in Configure.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label
                htmlFor="wwd-microphone"
                className="text-muted-foreground text-xs"
              >
                Microphone (on the service’s machine)
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Refresh the microphone list"
                disabled={devicesQuery.isFetching}
                onClick={() =>
                  void queryClient.invalidateQueries({
                    queryKey: wakeWordKey(apiBase, 'devices'),
                  })
                }
              >
                <RefreshCw
                  aria-hidden
                  className={cn(
                    'h-3.5 w-3.5',
                    devicesQuery.isFetching && 'animate-spin',
                  )}
                />
              </Button>
            </div>
            <Select
              value={microphone.value}
              onValueChange={setDeviceId}
              disabled={isDetecting}
            >
              <SelectTrigger
                id="wwd-microphone"
                className="w-full text-xs"
                data-testid="wwd-microphone"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {deviceOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isDetecting && (
              <p className="text-muted-foreground text-xs">
                Stop detection to change the microphone.
              </p>
            )}
          </div>

          <div className="flex gap-2">
            {isDetecting ? (
              <Button
                variant="destructive"
                onClick={() => stop.mutate()}
                disabled={isStopping}
                className="min-w-0 flex-1 gap-2 sm:min-w-[180px] sm:flex-none"
              >
                {isStopping ? (
                  <Loader aria-hidden className="h-4 w-4 animate-spin" />
                ) : (
                  <MicOff aria-hidden className="h-4 w-4" />
                )}
                Stop detection
              </Button>
            ) : (
              <Button
                onClick={handleStart}
                disabled={isStarting || !devicesLoaded}
                className="min-w-0 flex-1 gap-2 sm:min-w-[180px] sm:flex-none"
              >
                {isStarting ? (
                  <Loader aria-hidden className="h-4 w-4 animate-spin" />
                ) : (
                  <Mic aria-hidden className="h-4 w-4" />
                )}
                Start detection
              </Button>
            )}
            <Button
              onClick={() =>
                void queryClient.invalidateQueries({
                  queryKey: wakeWordKey(apiBase),
                })
              }
              variant="outline"
              size="icon"
              title="Refresh status"
              aria-label="Refresh status"
            >
              <RefreshCw aria-hidden className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="wwd-events-heading"
        className="border-border bg-card flex flex-col rounded-xl border p-4 sm:p-6"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3
            id="wwd-events-heading"
            className="text-foreground flex items-center gap-2 text-sm font-medium"
          >
            <Bell aria-hidden className="h-4 w-4" />
            Detection events
            {events.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {events.length}
              </Badge>
            )}
          </h3>
          {events.length > 0 && (
            <Button
              onClick={() => clearEvents()}
              variant="ghost"
              size="sm"
              className="text-muted-foreground h-8 gap-1 text-xs"
            >
              <X aria-hidden className="h-3 w-3" />
              Clear
            </Button>
          )}
        </div>

        {loadedModels.length === 0 ? (
          <EmptyState
            icon={AudioLines}
            size="sm"
            description={
              isDetecting
                ? 'Listening for wake words...'
                : 'Start detection to begin listening.'
            }
            className="py-8"
          />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {loadedModels.map((m) => (
              <ModelEventCard
                key={m}
                model={m}
                events={eventsByModel.get(m) ?? []}
                isTriggered={flash?.model === m}
              />
            ))}
          </div>
        )}
      </section>
    </DemoLayout>
  )
}
