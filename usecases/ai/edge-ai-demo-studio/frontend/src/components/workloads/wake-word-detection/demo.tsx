// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState, useMemo } from 'react'
import { useGetWebhookSubscribers } from '@/hooks/use-wake-word-detection'
import { Subscriber } from './add-subscriber-dialog'
import DetectionControl from './detection-control'
import WebhookSubscribers from './webhook-subscribers'
import { FRONTEND_PORT } from '@/lib/constants'

interface WakeWordDetectionDemoProps {
  disabled?: boolean
}

export default function WakeWordDetectionDemo({
  disabled,
}: WakeWordDetectionDemoProps) {
  const [hasLocalSubscriber, setHasLocalSubscriber] = useState(false)

  const {
    data: subscribersData,
    refetch: refetchSubscribers,
    isLoading,
  } = useGetWebhookSubscribers({ enabled: disabled !== true })

  const subscribers = useMemo(() => {
    return (subscribersData?.subscribers as Subscriber[]) || []
  }, [subscribersData])

  const [prevSubscribers, setPrevSubscribers] = useState(subscribers)

  if (subscribers !== prevSubscribers) {
    setPrevSubscribers(subscribers)
    // Check if local subscriber exists
    const localSub = subscribers.find(
      (s) =>
        s.url === `http://localhost:${FRONTEND_PORT}/api/wake-word-detected`,
    )
    setHasLocalSubscriber(!!localSub)
  }

  return (
    <div className="space-y-4">
      <DetectionControl
        disabled={disabled}
        totalSubscribers={subscribers.length}
        hasLocalSubscriber={hasLocalSubscriber}
        onAddLocalSubscriber={() => setHasLocalSubscriber(true)}
        onRefreshSubscribers={refetchSubscribers}
      />

      <WebhookSubscribers
        disabled={disabled}
        subscribers={subscribers}
        isLoading={isLoading}
        onAddLocalSubscriber={() => setHasLocalSubscriber(true)}
        onRefreshSubscribers={refetchSubscribers}
      />
    </div>
  )
}
