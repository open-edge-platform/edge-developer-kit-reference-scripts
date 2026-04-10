// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  AudioLines,
  Bell,
  Loader2,
  Mic,
  MicOff,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { useMemo, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { DemoParameterSidebar } from '@/services/common/demo/components/demo-parameter-sidebar'
import type { Service } from '@/services/types'
import {
  type Subscriber,
  useWakeWordHealth,
  useWakeWordSubscribers,
  useWakeWordDevices,
  useWakeWordModels,
  useSubscribeWebhook,
  useUnsubscribeWebhook,
  useToggleDetection,
} from './hooks'
import {
  useDetectionEvents,
  type DetectionEvent,
} from './hooks/use-detection-events'
import { useQuickStart } from './hooks/use-quick-start'
import { useWakeWordParams } from './hooks/use-params'
import { useAudioLevel } from './hooks/use-audio-level'

function formatRelativeTime(ts: string) {
  const now = Date.now()
  const then = new Date(ts).getTime()
  const diff = Math.floor((now - then) / 1000)
  if (diff < 5) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return new Date(ts).toLocaleTimeString()
}

function formatModelName(model: string) {
  return model
    .replace(/_/g, ' ')
    .replace(/v\d+\.\d+/, '')
    .trim()
}

function MicVisualization({
  isDetecting,
  audioLevel,
  hasAudio,
  detectionFlash,
}: {
  isDetecting: boolean
  audioLevel: number
  hasAudio: boolean
  detectionFlash: boolean
}) {
  return (
    <div className="relative flex items-center justify-center">
      {isDetecting && hasAudio && (
        <>
          <div
            className="border-primary/20 absolute rounded-full border-2 transition-all duration-150"
            style={{
              width: `${80 + audioLevel * 200}px`,
              height: `${80 + audioLevel * 200}px`,
              opacity: Math.min(audioLevel * 5, 0.6),
            }}
          />
          <div
            className="border-primary/30 absolute rounded-full border-2 transition-all duration-150"
            style={{
              width: `${80 + audioLevel * 120}px`,
              height: `${80 + audioLevel * 120}px`,
              opacity: Math.min(audioLevel * 8, 0.8),
            }}
          />
        </>
      )}
      {detectionFlash && (
        <div className="absolute h-28 w-28 animate-ping rounded-full bg-green-500/20 [animation-duration:0.6s]" />
      )}
      <div
        className={cn(
          'relative flex h-20 w-20 items-center justify-center rounded-full transition-all',
          isDetecting
            ? 'bg-primary/15 text-primary ring-primary/20 ring-4'
            : 'bg-muted/50 text-muted-foreground',
          detectionFlash &&
            'bg-green-500/15 text-green-400 ring-4 ring-green-500/40',
        )}
      >
        {isDetecting ? (
          <Mic className="h-8 w-8" />
        ) : (
          <MicOff className="h-8 w-8" />
        )}
      </div>
    </div>
  )
}

function ModelEventCard({
  model,
  events,
  isTriggered,
}: {
  model: string
  events: DetectionEvent[]
  isTriggered: boolean
}) {
  const count = events.length
  const hasEvents = count > 0
  const avgScore = hasEvents
    ? events.reduce((s, e) => s + e.score, 0) / count
    : 0
  const maxScore = hasEvents ? Math.max(...events.map((e) => e.score)) : 0
  const lastSeen = hasEvents ? events[0].timestamp : null
  const avgPct = Math.round(avgScore * 100)

  return (
    <div
      className={cn(
        'border-border bg-background rounded-lg border p-3 transition-colors',
        isTriggered && 'border-green-500/50 bg-green-500/5',
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full',
              hasEvents ? 'bg-green-500/10' : 'bg-muted',
            )}
          >
            <AudioLines
              className={cn(
                'h-3.5 w-3.5',
                hasEvents ? 'text-green-500' : 'text-muted-foreground',
              )}
            />
          </div>
          <span className="text-foreground text-sm font-medium">
            {formatModelName(model)}
          </span>
          {isTriggered && (
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-green-500" />
          )}
        </div>
        <Badge
          variant={hasEvents ? 'secondary' : 'outline'}
          className="text-[10px]"
        >
          {count} {count === 1 ? 'event' : 'events'}
        </Badge>
      </div>
      {hasEvents ? (
        <>
          <div className="text-muted-foreground mt-1.5 flex items-center gap-1.5 text-xs">
            <span>Avg {avgPct}%</span>
            <span className="text-border">·</span>
            <span>Best {Math.round(maxScore * 100)}%</span>
            <span className="text-border">·</span>
            <span>{lastSeen ? formatRelativeTime(lastSeen) : '—'}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  avgPct > 80
                    ? 'bg-green-500'
                    : avgPct > 60
                      ? 'bg-primary'
                      : 'bg-muted-foreground/40',
                )}
                style={{ width: `${avgPct}%` }}
              />
            </div>
            <span className="text-muted-foreground w-8 text-right text-[10px]">
              {avgPct}%
            </span>
          </div>
        </>
      ) : (
        <p className="text-muted-foreground mt-1.5 text-xs">
          No detections yet
        </p>
      )}
    </div>
  )
}

function WebhookSubscribers({
  subscribers,
  subscribeMutation,
  unsubscribeMutation,
}: {
  subscribers: Subscriber[]
  subscribeMutation: ReturnType<typeof useSubscribeWebhook>
  unsubscribeMutation: ReturnType<typeof useUnsubscribeWebhook>
}) {
  const [webhookUrl, setWebhookUrl] = useState('')
  const [subscriberName, setSubscriberName] = useState('')
  const [threshold, setThreshold] = useState('0.6')

  return (
    <div className="border-border border-t pt-4">
      <Accordion type="single" collapsible>
        <AccordionItem value="webhooks" className="border-none">
          <AccordionTrigger className="text-foreground py-0 text-xs font-medium">
            <span className="flex items-center gap-2">
              <Bell className="h-3.5 w-3.5" />
              Webhook Subscribers
              {subscribers.length > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  {subscribers.length}
                </Badge>
              )}
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-2 pt-3">
              <Input
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="Webhook URL"
                className="bg-muted/30 text-xs"
              />
              <div className="flex gap-2">
                <Input
                  value={subscriberName}
                  onChange={(e) => setSubscriberName(e.target.value)}
                  placeholder="Name"
                  className="bg-muted/30 text-xs"
                />
                <Input
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  placeholder="0.6"
                  type="number"
                  min="0"
                  max="1"
                  step="0.1"
                  className="bg-muted/30 w-16 text-xs"
                />
              </div>
              <Button
                onClick={() => {
                  if (!webhookUrl.trim()) return
                  subscribeMutation.mutate(
                    {
                      url: webhookUrl.trim(),
                      name: subscriberName.trim() || undefined,
                      threshold: Number.parseFloat(threshold) || 0.6,
                    },
                    {
                      onSuccess: () => {
                        setWebhookUrl('')
                        setSubscriberName('')
                      },
                    },
                  )
                }}
                disabled={subscribeMutation.isPending || !webhookUrl.trim()}
                size="sm"
                className="bg-primary hover:bg-primary-light w-full gap-1.5 text-xs text-white"
              >
                {subscribeMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="h-3 w-3" />
                )}
                Subscribe
              </Button>

              <div className="max-h-[180px] space-y-1.5 overflow-auto">
                {subscribers.length === 0 ? (
                  <p className="text-muted-foreground py-3 text-center text-[11px]">
                    No subscribers yet.
                  </p>
                ) : (
                  subscribers.map((sub) => (
                    <div
                      key={sub.id}
                      className="border-border flex items-center justify-between rounded-lg border p-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">
                          {sub.name}
                        </p>
                        <p className="text-muted-foreground truncate text-[10px]">
                          {sub.url}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Badge variant="secondary" className="text-[10px]">
                          {sub.threshold}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => unsubscribeMutation.mutate(sub.url)}
                        >
                          <Trash2 className="text-destructive h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main Demo                                                         */
/* ------------------------------------------------------------------ */

export function WakeWordDetectionDemo(_props: { service: Service }) {
  const queryClient = useQueryClient()

  // Queries
  const healthQuery = useWakeWordHealth(true)
  const subscribersQuery = useWakeWordSubscribers(true)
  const devicesQuery = useWakeWordDevices(true)
  const modelsQuery = useWakeWordModels(true)

  // Mutations
  const subscribeMutation = useSubscribeWebhook()
  const unsubscribeMutation = useUnsubscribeWebhook()
  const toggleMutation = useToggleDetection()
  const quickStartMutation = useQuickStart()

  // Derived state
  const health = healthQuery.data ?? null
  const isDetecting = health?.detection_active ?? false
  const loadedModels = modelsQuery.data?.loadedModels ?? health?.models ?? []
  const subscribers = subscribersQuery.data ?? []
  const devices = devicesQuery.data?.devices ?? []

  // Params hook
  const refreshDevices = () => {
    queryClient.invalidateQueries({
      queryKey: ['wake-word-detection', 'devices'],
    })
  }
  const { values: paramValues, params } = useWakeWordParams(devices, {
    onRefreshDevices: refreshDevices,
    isRefreshingDevices: devicesQuery.isFetching,
  })

  // Detection events
  const { events, latestEvent, clearEvents, resetSince } =
    useDetectionEvents(isDetecting)

  // Real-time audio level from the worker
  const { level: audioLevel } = useAudioLevel(isDetecting)
  const hasAudio = audioLevel > 0.01

  // Flash animation on detection
  const lastEventIdRef = useRef<string | null>(null)
  const [detectionFlash, setDetectionFlash] = useState(false)
  useEffect(() => {
    if (!latestEvent) return
    const eventId = `${latestEvent.timestamp}-${latestEvent.model}`
    if (eventId === lastEventIdRef.current) return
    lastEventIdRef.current = eventId
    const flashOn = setTimeout(() => setDetectionFlash(true), 0)
    const flashOff = setTimeout(() => setDetectionFlash(false), 2000)
    return () => {
      clearTimeout(flashOn)
      clearTimeout(flashOff)
    }
  }, [latestEvent])

  // Stop detection when navigating away from the page
  const isDetectingRef = useRef(isDetecting)
  useEffect(() => {
    isDetectingRef.current = isDetecting
  }, [isDetecting])
  useEffect(() => {
    return () => {
      if (isDetectingRef.current) {
        fetch(`/api/wake-word-detection/v1/wake-word-detection/stop`, {
          method: 'POST',
        })
      }
    }
  }, [])

  const isStarting = quickStartMutation.isPending
  const isStopping = toggleMutation.isPending && isDetecting

  const error =
    quickStartMutation.error?.message ??
    subscribersQuery.error?.message ??
    subscribeMutation.error?.message ??
    unsubscribeMutation.error?.message ??
    toggleMutation.error?.message ??
    null

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['wake-word-detection'] })
  }

  const handleStart = () => {
    resetSince()
    quickStartMutation.mutate({
      deviceId:
        paramValues.deviceId !== 'default'
          ? Number(paramValues.deviceId)
          : null,
      threshold: paramValues.detectionThreshold,
    })
  }

  const handleStop = () => {
    toggleMutation.mutate({ start: false })
  }

  const eventsByModel = useMemo(() => {
    const map = new Map<string, DetectionEvent[]>()
    for (const evt of events) {
      const group = map.get(evt.model) ?? []
      group.push(evt)
      map.set(evt.model, group)
    }
    return map
  }, [events])

  return (
    <div className="space-y-6">
      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* Left column — Detection Control + Events */}
        <div className="flex flex-col gap-6">
          {/* Detection Control */}
          <div className="border-border bg-card flex flex-[7] flex-col rounded-xl border p-6">
            <div className="flex items-center justify-between">
              <p className="text-foreground flex items-center gap-2 text-sm font-medium">
                <AudioLines className="h-4 w-4" />
                Detection Control
              </p>
              <Badge
                variant={isDetecting ? 'default' : 'outline'}
                className={cn(
                  'text-[10px]',
                  isDetecting && 'bg-green-600 hover:bg-green-700',
                )}
              >
                {isDetecting ? 'Listening' : 'Stopped'}
              </Badge>
            </div>

            <div className="flex flex-1 flex-col items-center justify-center gap-4 py-6">
              <MicVisualization
                isDetecting={isDetecting}
                audioLevel={audioLevel}
                hasAudio={hasAudio}
                detectionFlash={detectionFlash}
              />

              <p className="text-muted-foreground text-center text-sm">
                {isDetecting
                  ? detectionFlash
                    ? `Detected: ${latestEvent ? formatModelName(latestEvent.model) : 'wake word'}!`
                    : 'Listening... Say your wake word'
                  : loadedModels.length > 0
                    ? `Say "${formatModelName(loadedModels[0])}" to trigger detection`
                    : 'Click Start to begin wake word detection'}
              </p>

              <div className="flex gap-2">
                {isDetecting ? (
                  <Button
                    onClick={handleStop}
                    disabled={isStopping}
                    className="min-w-[180px] gap-2 bg-red-600 text-white hover:bg-red-700"
                  >
                    {isStopping ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <MicOff className="h-4 w-4" />
                    )}
                    Stop Detection
                  </Button>
                ) : (
                  <Button
                    onClick={handleStart}
                    disabled={isStarting}
                    className="bg-primary hover:bg-primary-light min-w-[180px] gap-2 text-white"
                  >
                    {isStarting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Mic className="h-4 w-4" />
                    )}
                    Start Detection
                  </Button>
                )}
                <Button
                  onClick={refreshAll}
                  variant="outline"
                  size="icon"
                  title="Refresh status"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Detection Events */}
          <div className="border-border bg-card flex flex-[3] flex-col rounded-xl border p-6">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-foreground flex items-center gap-2 text-sm font-medium">
                <Bell className="h-4 w-4" />
                Detection Events
                {events.length > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    {events.length}
                  </Badge>
                )}
              </p>
              {events.length > 0 && (
                <Button
                  onClick={() => clearEvents()}
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground h-7 gap-1 text-xs"
                >
                  <X className="h-3 w-3" />
                  Clear
                </Button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              {loadedModels.length === 0 ? (
                <div className="text-muted-foreground flex flex-col items-center justify-center py-8 text-center text-xs">
                  <AudioLines className="text-muted-foreground/40 mb-3 h-8 w-8" />
                  {isDetecting
                    ? 'Listening for wake words...'
                    : 'Start detection to begin listening.'}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {loadedModels.map((m) => (
                    <ModelEventCard
                      key={m}
                      model={m}
                      events={eventsByModel.get(m) ?? []}
                      isTriggered={latestEvent?.model === m && detectionFlash}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right column — Parameters */}
        <DemoParameterSidebar params={params}>
          <WebhookSubscribers
            subscribers={subscribers}
            subscribeMutation={subscribeMutation}
            unsubscribeMutation={unsubscribeMutation}
          />
        </DemoParameterSidebar>
      </div>
    </div>
  )
}
