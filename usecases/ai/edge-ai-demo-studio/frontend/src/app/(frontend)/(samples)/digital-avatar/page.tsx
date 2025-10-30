// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { User, Play, Settings } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  getInactivePrerequisites,
  getPreparingPrerequisites,
  startPrerequisites,
} from '@/utils/prerequisite-utils'
import {
  useCreateWorkload,
  useGetWorkloadByType,
  useGetWorkloadsStatus,
  useUpdateWorkload,
} from '@/hooks/use-workload'
import {
  AvatarStream,
  ConversationPanel,
  DigitalAvatarSettings,
} from '@/components/samples/digital-avatar'
import { Badge } from '@/components/ui/badge'
import { KnowledgeBase } from '@/types/embedding'
import { TEXT_GENERATION_WORKLOAD } from '@/lib/workloads/text-generation'

export default function DigitalAvatarPage() {
  const { data: lipsyncService, isLoading: isLipsyncLoading } =
    useGetWorkloadByType('lipsync')
  const { data: ttsService } = useGetWorkloadByType('text-to-speech')
  const { data: workloads } = useGetWorkloadsStatus()
  const createWorkload = useCreateWorkload()
  const updateWorkload = useUpdateWorkload()

  const [sessionId, setSessionId] = useState('')
  const [connectionStatus, setConnectionStatus] = useState('disconnected')
  const [useEmbedding, setUseEmbedding] = useState(false)
  const [selectedKnowledgeBase, setSelectedKnowledgeBase] =
    useState<KnowledgeBase | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  const prerequisiteServices = useMemo(() => {
    const ps = ['text-generation', 'text-to-speech', 'lipsync']

    if (useEmbedding) ps.push('embedding')

    return ps
  }, [useEmbedding])

  const handleSessionIdChange = (newSessionId: string) => {
    setSessionId(newSessionId)
  }

  const handleSettingsUpdate = (settings: {
    useEmbedding: boolean
    selectedKnowledgeBase: KnowledgeBase | null
  }) => {
    setUseEmbedding(settings.useEmbedding)
    setSelectedKnowledgeBase(settings.selectedKnowledgeBase)
  }

  const SettingsButton = () => (
    <Button
      variant="outline"
      size="icon"
      className="size-8"
      onClick={() => setIsSettingsOpen(true)}
      disabled={
        inactivePrerequisites.length > 0 ||
        isLipsyncLoading ||
        (preparingPrerequisites && preparingPrerequisites.length > 0)
      }
    >
      <Settings className="h-4 w-4" />
    </Button>
  )

  const inactivePrerequisites = useMemo(() => {
    return getInactivePrerequisites(prerequisiteServices, workloads)
  }, [prerequisiteServices, workloads])

  const preparingPrerequisites = useMemo(() => {
    return getPreparingPrerequisites(prerequisiteServices, workloads)
  }, [prerequisiteServices, workloads])

  const preparePrerequisite = useCallback(() => {
    startPrerequisites(
      prerequisiteServices,
      workloads,
      createWorkload,
      updateWorkload,
    )
  }, [createWorkload, prerequisiteServices, updateWorkload, workloads])

  return (
    <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="container mx-auto p-4">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-600 text-white">
              <User className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                Digital Avatar
              </h1>
              <p className="text-slate-600 dark:text-slate-400">
                Interact with an AI-powered avatar that combines real-time video
                with intelligent conversation
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {selectedKnowledgeBase && (
              <Badge
                variant="secondary"
                className="flex items-center gap-1.5 border-blue-200 bg-blue-100 px-3 py-1 text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200"
              >
                <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500"></div>
                RAG On • {selectedKnowledgeBase.name}
              </Badge>
            )}
            <SettingsButton />
          </div>
        </div>

        {/* Prerequisites Button */}
        {inactivePrerequisites && inactivePrerequisites.length > 0 && (
          <div className="mb-6">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-amber-800 dark:text-amber-200">
                    Prerequisites Required
                  </h3>
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    The following services need to be started:{' '}
                    {inactivePrerequisites.join(', ')}
                  </p>
                </div>
                <Button
                  onClick={preparePrerequisite}
                  className="bg-blue-600 text-white hover:bg-blue-700"
                  disabled={
                    createWorkload.isPending ||
                    updateWorkload.isPending ||
                    (preparingPrerequisites &&
                      preparingPrerequisites.length > 0)
                  }
                >
                  <Play className="mr-2 h-4 w-4" />
                  {createWorkload.isPending || updateWorkload.isPending
                    ? 'Starting...'
                    : 'Start All Services'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Prerequisites Preparing Notification */}
        {preparingPrerequisites && preparingPrerequisites.length > 0 && (
          <div className="mb-6">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 animate-pulse rounded-full bg-blue-600"></div>
                <div>
                  <h3 className="font-semibold text-blue-800 dark:text-blue-200">
                    Prerequisites Starting
                  </h3>
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    The following services are currently starting:{' '}
                    <strong>{preparingPrerequisites.join(', ')}</strong>. Please
                    wait for them to finish.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-3">
          {/* Video Stream */}
          <div className="lg:col-span-2">
            <AvatarStream
              disabled={
                inactivePrerequisites.length > 0 ||
                isLipsyncLoading ||
                (preparingPrerequisites && preparingPrerequisites.length > 0)
              }
              turnServerIp={lipsyncService?.metadata?.turnServerIp || ''}
              onSessionIdChange={handleSessionIdChange}
              connectionStatus={connectionStatus}
              setConnectionStatus={setConnectionStatus}
            />
          </div>

          {/* Sidebar with Instructions and Chat */}
          <div className="space-y-6">
            <ConversationPanel
              disabled={
                inactivePrerequisites.length > 0 ||
                (preparingPrerequisites && preparingPrerequisites.length > 0)
              }
              sessionId={sessionId}
              connectionStatus={connectionStatus}
              knowledgeBaseId={selectedKnowledgeBase?.id || undefined}
              selectedModel={
                ttsService?.model || TEXT_GENERATION_WORKLOAD.model
              }
            />
          </div>
        </div>

        {/* Settings Modal */}
        <DigitalAvatarSettings
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          useEmbedding={useEmbedding}
          selectedKnowledgeBase={selectedKnowledgeBase}
          onSettingsUpdate={handleSettingsUpdate}
        />
      </div>
    </div>
  )
}
