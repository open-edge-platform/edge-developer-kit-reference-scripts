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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Play,
  Square,
  Loader2,
  Mic,
  ChevronDown,
  ChevronUp,
  Plus,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  useStartDetection,
  useStopDetection,
  useGetDetectionStatus,
  useSubscribeWebhook,
  useListAudioDevices,
} from '@/hooks/use-wake-word-detection'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { FRONTEND_PORT } from '@/lib/constants'
import { Badge } from '@/components/ui/badge'
import { logger } from '@/utils/logger'

interface DetectionControlProps {
  disabled?: boolean
  totalSubscribers: number
  hasLocalSubscriber: boolean
  onAddLocalSubscriber: () => void
  onRefreshSubscribers: () => void
}

export default function DetectionControl({
  disabled,
  totalSubscribers,
  hasLocalSubscriber,
  onAddLocalSubscriber,
  onRefreshSubscribers,
}: DetectionControlProps) {
  const [isLogExpanded, setIsLogExpanded] = useState(false)
  const [selectedDeviceId, setSelectedDeviceId] = useState<number>(-1)
  const startDetection = useStartDetection()
  const stopDetection = useStopDetection()
  const subscribeWebhook = useSubscribeWebhook()
  const {
    data: statusData,
    refetch: refetchStatus,
    isLoading: isLoadingStatus,
  } = useGetDetectionStatus({ enabled: true })
  const { data: audioDevicesData, isLoading: isLoadingDevices } =
    useListAudioDevices({ enabled: !disabled })

  const detectionActive =
    statusData?.detection_active === true ||
    statusData?.detection_active === 'true'

  const [modelDetections, setModelDetections] = useState<
    Record<string, { score: number; timestamp: string; flash: boolean }>
  >({})

  useEffect(() => {
    if (audioDevicesData && audioDevicesData.selected_device_id) {
      setSelectedDeviceId(audioDevicesData.selected_device_id)
    }
  }, [audioDevicesData])

  // Connect to SSE for real-time detection events
  useEffect(() => {
    if (!hasLocalSubscriber || disabled || !detectionActive) return

    let eventSource: EventSource | null = null

    const connectSSE = () => {
      eventSource = new EventSource('/api/wake-word-detected')

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'detection') {
            const detection = data.event

            setModelDetections((prev) => ({
              ...prev,
              [detection.model]: {
                score: detection.score,
                timestamp: detection.timestamp,
                flash: true,
              },
            }))

            // Remove flash after 2 seconds
            setTimeout(() => {
              setModelDetections((prev) => ({
                ...prev,
                [detection.model]: {
                  ...prev[detection.model],
                  flash: false,
                },
              }))
            }, 2000)
          }
        } catch (error) {
          logger.error('Failed to parse SSE event:', error)
        }
      }

      eventSource.onerror = (error) => {
        logger.error('SSE connection error:', error)
        eventSource?.close()
        // Reconnect after 3 seconds
        setTimeout(connectSSE, 3000)
      }
    }

    connectSSE()

    return () => {
      if (eventSource) {
        eventSource.close()
      }
    }
  }, [hasLocalSubscriber, disabled, detectionActive])

  const handleAddLocalSubscriber = async () => {
    try {
      await subscribeWebhook.mutateAsync({
        name: 'Local',
        url: `http://localhost:${FRONTEND_PORT}/api/wake-word-detected`,
        threshold: 0.5,
      })
      toast.success('Local webhook subscriber added')
      onRefreshSubscribers()
      onAddLocalSubscriber()
    } catch (error) {
      logger.error('Error adding local subscriber:', error)
      toast.error('Failed to add local webhook subscriber')
    }
  }

  const handleStart = async () => {
    try {
      const result = await startDetection.mutateAsync(selectedDeviceId)
      toast.success(
        result.message || 'Wake word detection started successfully',
      )
      refetchStatus()
    } catch (error) {
      logger.error('Error starting detection:', error)
      const errorMessage =
        String(error) || 'Failed to start wake word detection'
      toast.error(errorMessage)
    }
  }

  const handleStop = async () => {
    try {
      const result = await stopDetection.mutateAsync()
      toast.success(result.message || 'Wake word detection stopped')
      refetchStatus()
    } catch (error) {
      logger.error('Error stopping detection:', error)
      toast.error('Failed to stop wake word detection')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Mic className="h-5 w-5" />
              <h3 className="text-lg font-semibold">Detection Control</h3>
            </div>
            <CardDescription className="text-muted-foreground text-sm font-normal">
              Start or stop wake word detection on the server&apos;s microphone
            </CardDescription>
          </div>

          <div className="flex items-center gap-3">
            {audioDevicesData && audioDevicesData.devices.length === 0}
            {!detectionActive &&
              !disabled &&
              (audioDevicesData && audioDevicesData.devices.length > 0 ? (
                <Select
                  value={selectedDeviceId?.toString() ?? '-1'}
                  onValueChange={(value) =>
                    setSelectedDeviceId(parseInt(value))
                  }
                  disabled={isLoadingDevices}
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Select audio device" />
                  </SelectTrigger>
                  <SelectContent>
                    {audioDevicesData?.devices?.map(
                      (device: {
                        id: number
                        name: string
                        max_input_channels: number
                      }) => (
                        <SelectItem
                          key={device.id}
                          value={device.id.toString()}
                        >
                          {device.name}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              ) : (
                <Badge
                  variant="secondary"
                  className="flex items-center gap-1.5 border-orange-200 bg-orange-100 px-3 py-1 text-orange-800 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-200"
                >
                  No audio input devices found
                </Badge>
              ))}
            {detectionActive ? (
              <Button
                onClick={handleStop}
                variant="destructive"
                disabled={
                  disabled || stopDetection.isPending || totalSubscribers === 0
                }
                className="flex items-center gap-2"
              >
                {stopDetection.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Square className="h-4 w-4" />
                )}
                Stop Detection
              </Button>
            ) : (
              <Button
                onClick={handleStart}
                disabled={
                  disabled ||
                  startDetection.isPending ||
                  totalSubscribers === 0 ||
                  isLoadingStatus ||
                  isLoadingDevices ||
                  (!isLoadingDevices &&
                    audioDevicesData &&
                    audioDevicesData.devices.length === 0)
                }
                className="flex items-center gap-2"
              >
                {startDetection.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Start Detection
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {disabled ? (
          <div className="border-muted rounded-lg border-2 border-dashed p-8 text-center">
            <div className="bg-muted mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
              <Mic className="text-muted-foreground h-6 w-6" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">
              Service is currently offline
            </h3>
            <p className="text-muted-foreground mx-auto mb-4 max-w-sm">
              Please start the wake word detection service to control detection.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border p-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="font-medium">
                  {totalSubscribers === 0
                    ? 'No webhook subscribers registered'
                    : 'Detection Status'}
                </h4>
                {totalSubscribers > 0 && (
                  <div className="bg-muted flex items-center gap-1.5 rounded-full px-2 py-0.5">
                    <div
                      className={`h-1.5 w-1.5 rounded-full ${
                        detectionActive ? 'bg-green-500' : 'bg-gray-300'
                      }`}
                    />
                    <span className="text-xs font-medium">
                      {isLoadingStatus
                        ? 'Checking...'
                        : detectionActive
                          ? 'Active'
                          : 'Inactive'}
                    </span>
                  </div>
                )}
              </div>
              <p className="text-muted-foreground text-sm">
                {detectionActive
                  ? 'The service is actively listening for wake words and will notify all registered webhook subscribers when detected.'
                  : totalSubscribers === 0
                    ? 'Please add at least one webhook subscriber to start wake word detection.'
                    : 'Detection is currently stopped. Click "Start Detection" to begin listening for wake words.'}
              </p>
              {detectionActive && statusData?.models && (
                <div className="mt-2">
                  <p className="text-muted-foreground text-sm">
                    <span className="font-medium">Active models:</span>{' '}
                    {(statusData.models as string[]).length} loaded
                  </p>
                  {statusData && statusData?.subscribers !== undefined && (
                    <p className="text-muted-foreground text-sm">
                      <span className="font-medium">Subscribers:</span>{' '}
                      {statusData.subscribers as number} registered
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {!disabled && (
          <Collapsible open={isLogExpanded} onOpenChange={setIsLogExpanded}>
            <div className="rounded-lg border">
              <CollapsibleTrigger className="hover:bg-muted/50 flex w-full items-center justify-between p-4">
                <h4 className="font-medium">Active Models</h4>
                {isLogExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </CollapsibleTrigger>

              <CollapsibleContent>
                <div className="border-t p-4">
                  {!hasLocalSubscriber ? (
                    <div className="py-8 text-center">
                      <div className="bg-muted mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
                        <Mic className="text-muted-foreground h-6 w-6" />
                      </div>
                      <h4 className="mb-2 font-medium">
                        Enable Detection Logs
                      </h4>
                      <p className="text-muted-foreground mb-4 text-sm">
                        Add the local webhook subscriber to see detection events
                        in real-time
                      </p>
                      <div className="flex justify-center">
                        <Button
                          onClick={handleAddLocalSubscriber}
                          disabled={subscribeWebhook.isPending}
                          className="flex items-center gap-2"
                        >
                          {subscribeWebhook.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Plus className="h-4 w-4" />
                          )}
                          Add Local Subscriber
                        </Button>
                      </div>
                    </div>
                  ) : !detectionActive || !statusData?.models ? (
                    <div className="py-8 text-center">
                      <p className="text-muted-foreground text-sm">
                        Start detection to see wake word model status.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {(statusData.models as string[]).map((modelName) => {
                        const detection = modelDetections[modelName]
                        const hasDetection = !!detection
                        const isFlashing = detection?.flash

                        return (
                          <div
                            key={modelName}
                            className={`rounded-lg border p-4 transition-all duration-300 ${
                              isFlashing
                                ? 'border-green-500 bg-green-500/10'
                                : 'border-border bg-card'
                            }`}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <Mic
                                    className={`h-4 w-4 ${
                                      isFlashing
                                        ? 'text-green-500'
                                        : 'text-muted-foreground'
                                    }`}
                                  />
                                  <h5 className="truncate text-sm font-medium">
                                    {modelName}
                                  </h5>
                                </div>
                                {hasDetection ? (
                                  <div className="mt-2 space-y-1">
                                    <div className="flex items-baseline gap-2">
                                      <span className="text-muted-foreground text-xs">
                                        Confidence:
                                      </span>
                                      <span
                                        className={`font-mono text-sm font-medium ${
                                          isFlashing
                                            ? 'text-green-600'
                                            : 'text-foreground'
                                        }`}
                                      >
                                        {(detection.score * 100).toFixed(1)}%
                                      </span>
                                    </div>
                                    <div className="flex items-baseline gap-2">
                                      <span className="text-muted-foreground text-xs">
                                        Last detected:
                                      </span>
                                      <span className="text-foreground text-xs">
                                        {new Date(
                                          detection.timestamp,
                                        ).toLocaleTimeString()}
                                      </span>
                                    </div>
                                  </div>
                                ) : (
                                  <p className="text-muted-foreground mt-2 text-xs">
                                    No detections yet
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  )
}
