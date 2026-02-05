// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { MessageSquare } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import {
  getInactivePrerequisites,
  getPreparingPrerequisites,
  startPrerequisites,
} from '@/utils/prerequisite-utils'
import {
  useCreateWorkload,
  useGetWorkloadsStatus,
  useUpdateWorkload,
} from '@/hooks/use-workload'
import { ChatPanel, RagChatSettings } from '@/components/samples/rag-chat'
import { Badge } from '@/components/ui/badge'
import { KnowledgeBase } from '@/types/embedding'
import { TEXT_GENERATION_TYPE } from '@/lib/workloads/text-generation'
import { SampleHeader, PrerequisiteBanner } from '@/components/samples'
import { EMBEDDING_TYPE } from '@/lib/workloads/embedding'

export default function RagChatPage() {
  const { data: workloads, isLoading: isWorkloadsLoading } =
    useGetWorkloadsStatus()
  const createWorkload = useCreateWorkload()
  const updateWorkload = useUpdateWorkload()

  const [useEmbedding, setUseEmbedding] = useState(false)
  const [selectedKnowledgeBase, setSelectedKnowledgeBase] =
    useState<KnowledgeBase | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  const prerequisiteServices = useMemo(() => {
    const ps: string[] = [TEXT_GENERATION_TYPE, EMBEDDING_TYPE]
    return ps
  }, [])

  const handleSettingsUpdate = (settings: {
    useEmbedding: boolean
    selectedKnowledgeBase: KnowledgeBase | null
  }) => {
    setUseEmbedding(settings.useEmbedding)
    setSelectedKnowledgeBase(settings.selectedKnowledgeBase)
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
        icon={MessageSquare}
        title="RAG Chat"
        description="Chat with AI using Retrieval-Augmented Generation for context-aware responses"
        onOpenSettings={() => setIsSettingsOpen(true)}
        disabled={isDisabled}
        badge={
          selectedKnowledgeBase ? (
            <Badge
              variant="secondary"
              className="flex items-center gap-1.5 border-blue-200 bg-blue-100 px-3 py-1 text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200"
            >
              <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500"></div>
              RAG On • {selectedKnowledgeBase.name}
            </Badge>
          ) : undefined
        }
      />

      <PrerequisiteBanner
        inactivePrerequisites={inactivePrerequisites}
        preparingPrerequisites={preparingPrerequisites}
        isLoading={isWorkloadsLoading}
        onStart={preparePrerequisite}
        isStarting={createWorkload.isPending || updateWorkload.isPending}
      />

      <div className="flex flex-1 flex-col overflow-hidden p-6">
        <div className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-lg border bg-white shadow-lg dark:bg-slate-900">
          <ChatPanel
            disabled={isDisabled}
            knowledgeBaseId={selectedKnowledgeBase?.id || undefined}
          />
        </div>
      </div>

      <RagChatSettings
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        useEmbedding={useEmbedding}
        selectedKnowledgeBase={selectedKnowledgeBase}
        onSettingsUpdate={handleSettingsUpdate}
      />
    </>
  )
}
