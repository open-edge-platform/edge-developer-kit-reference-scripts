// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { User } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
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
  AvatarSection,
  ConversationPanel,
} from '@/components/samples/digital-avatar-lite'
import { Badge } from '@/components/ui/badge'
import { KnowledgeBase } from '@/types/embedding'
import { TEXT_GENERATION_TYPE } from '@/lib/workloads/text-generation'
import { DigitalAvatarSettings } from '@/components/common/digital-avatar-settings'
import {
  TEXT_TO_SPEECH_TYPE,
  TEXT_TO_SPEECH_WORKLOAD,
} from '@/lib/workloads/text-to-speech'
import { EMBEDDING_TYPE } from '@/lib/workloads/embedding'
import { SPEECH_TO_TEXT_TYPE } from '@/lib/workloads/speech-to-text'
import { PrerequisiteBanner, SampleHeader } from '@/components/samples'
import SamplesBody from '@/components/samples/samples-body'

export default function DigitalAvatarLitePage() {
  const { data: ttsService, isLoading: isTTSLoading } =
    useGetWorkloadByType(TEXT_TO_SPEECH_TYPE)
  const { data: workloads, isLoading: isWorkloadsLoading } =
    useGetWorkloadsStatus()
  const createWorkload = useCreateWorkload()
  const updateWorkload = useUpdateWorkload()

  const [useWakeWordDetection, setUseWakeWordDetection] = useState(false)
  const [useSTT, setUseSTT] = useState(false)
  const [useDenoise, setUseDenoise] = useState(true)
  const [useEmbedding, setUseEmbedding] = useState(false)
  const [selectedKnowledgeBase, setSelectedKnowledgeBase] =
    useState<KnowledgeBase | null>(null)
  const [useMcpTools, setUseMcpTools] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  const [streamUrl] = useState('/api/digital-avatar-lite/stream')

  const prerequisiteServices = useMemo(() => {
    return [
      TEXT_GENERATION_TYPE,
      TEXT_TO_SPEECH_TYPE,
      ...(useSTT ? [SPEECH_TO_TEXT_TYPE] : []),
      ...(useEmbedding ? [EMBEDDING_TYPE] : []),
    ]
  }, [useEmbedding, useSTT])

  const handleSettingsUpdate = (settings: {
    useSTT: boolean
    useDenoise: boolean
    useEmbedding: boolean
    selectedKnowledgeBase: KnowledgeBase | null
    useMcpTools: boolean
    useWakeWordDetection?: boolean
  }) => {
    setUseSTT(settings.useSTT)
    setUseDenoise(settings.useDenoise)
    setUseEmbedding(settings.useEmbedding)
    setSelectedKnowledgeBase(settings.selectedKnowledgeBase)
    setUseMcpTools(settings.useMcpTools)
    setUseWakeWordDetection(settings.useWakeWordDetection || false)
  }

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

  const isDisabled =
    inactivePrerequisites.length > 0 ||
    (preparingPrerequisites && preparingPrerequisites.length > 0)

  return (
    <>
      <SampleHeader
        icon={User}
        title="Digital Avatar Lite"
        description="A lightweight animated robot avatar that brings conversations to life with responsive movements and expressions."
        onOpenSettings={() => setIsSettingsOpen(true)}
        disabled={isDisabled}
        badge={
          <>
            {selectedKnowledgeBase && (
              <Badge
                variant="secondary"
                className="flex items-center gap-1.5 border-blue-200 bg-blue-100 px-3 py-1 text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200"
              >
                <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500"></div>
                RAG On • {selectedKnowledgeBase.name}
              </Badge>
            )}
            {useMcpTools && (
              <Badge
                variant="secondary"
                className="flex items-center gap-1.5 border-green-200 bg-green-100 px-3 py-1 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-200"
              >
                <div className="h-2 w-2 animate-pulse rounded-full bg-green-500"></div>
                MCP Tools On
              </Badge>
            )}
            {useWakeWordDetection && (
              <Badge
                variant="secondary"
                className="flex items-center gap-1.5 border-red-200 bg-red-100 px-3 py-1 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200"
              >
                <div className="h-2 w-2 animate-pulse rounded-full bg-red-500"></div>
                Wake Word Detection On
              </Badge>
            )}
          </>
        }
      />

      <PrerequisiteBanner
        inactivePrerequisites={inactivePrerequisites}
        preparingPrerequisites={preparingPrerequisites}
        isLoading={isWorkloadsLoading || isTTSLoading}
        onStart={preparePrerequisite}
        isStarting={createWorkload.isPending || updateWorkload.isPending}
      />

      <SamplesBody>
        <div className="grid gap-8 lg:grid-cols-3">
          {/* Video Stream */}
          <div className="lg:col-span-2">
            <AvatarSection streamUrl={streamUrl} />
          </div>

          {/* Sidebar with Instructions and Chat */}
          <div className="space-y-6">
            <ConversationPanel
              disabled={
                inactivePrerequisites.length > 0 ||
                (preparingPrerequisites && preparingPrerequisites.length > 0)
              }
              useWakeWordDetection={useWakeWordDetection}
              isSTTEnabled={useSTT}
              isDenoiseEnabled={useDenoise}
              knowledgeBaseId={selectedKnowledgeBase?.id || undefined}
              selectedModel={
                ttsService?.models.default.name ||
                TEXT_TO_SPEECH_WORKLOAD.models.default.name
              }
              useMcpTools={useMcpTools}
            />
          </div>
        </div>
      </SamplesBody>

      {/* Settings Modal */}
      <DigitalAvatarSettings
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        useSTT={useSTT}
        useDenoise={useDenoise}
        useEmbedding={useEmbedding}
        selectedKnowledgeBase={selectedKnowledgeBase}
        useMcpTools={useMcpTools}
        onSettingsUpdate={handleSettingsUpdate}
      />
    </>
  )
}
