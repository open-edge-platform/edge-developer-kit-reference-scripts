// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  DocumentationTemplate,
  DocumentationProps,
} from '@/components/workloads/documentation'
import Logs from '@/components/workloads/log'
import { embeddingEndpoints } from '@/components/workloads/embedding/api'
import EmbeddingDemo from '@/components/workloads/embedding/demo'
import EmbeddingDocumentation from '@/components/workloads/embedding/documentation'
import WorkloadComponent from '@/components/workloads/workload'
import {
  useCreateWorkload,
  useGetWorkloadByType,
  useUpdateWorkload,
} from '@/hooks/use-workload'
import { useMemo } from 'react'

import useDisclosure from '@/hooks/use-disclosure'
import {
  EmbeddingSettingsModal,
  EmbeddingSettings,
} from '@/components/workloads/embedding/settings'
import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'
import {
  EMBEDDING_TYPE,
  EMBEDDING_DESCRIPTION,
  EMBEDDING_MODELS,
  EMBEDDING_RERANKER_MODELS,
  EMBEDDING_WORKLOAD,
} from '@/lib/workloads/embedding'
import { EMBEDDING_PORT } from '@/lib/constants'
import Endpoint from '@/components/workloads/endpoint'

const TYPE = EMBEDDING_TYPE
const DESCRIPTION = EMBEDDING_DESCRIPTION

export default function EmbeddingPage() {
  const { data: workload, isLoading } = useGetWorkloadByType('embedding')
  const { isOpen, onClose, onOpen } = useDisclosure()

  const updateWorkload = useUpdateWorkload()
  const createWorkload = useCreateWorkload()

  const modelName = useMemo(() => {
    const parts = (workload?.model ?? EMBEDDING_WORKLOAD.model).split('/')
    return parts.length > 1
      ? parts[1]
      : (workload?.model ?? EMBEDDING_WORKLOAD.model)
  }, [workload?.model])

  const data: DocumentationProps = {
    overview: (
      <EmbeddingDocumentation
        port={workload?.port ?? EMBEDDING_PORT}
        model={modelName}
      />
    ),
    endpoints: (
      <Endpoint
        apis={embeddingEndpoints}
        port={workload?.port ?? EMBEDDING_PORT}
      />
    ),
  }

  const updateSettings = (settings: EmbeddingSettings) => {
    return new Promise<void>((resolve) => {
      if (!workload) {
        createWorkload.mutate(
          {
            ...EMBEDDING_WORKLOAD,
            device: settings.embeddingDevice,
            model: settings.embeddingModel.value,
            metadata: {
              rerankerModel: settings.rerankerModel.value,
              rerankerDevice: settings.rerankerDevice,
            },
            status: 'inactive',
          },
          {
            onSuccess: () => resolve(),
            onError: () => resolve(),
          },
        )
      } else if (workload && !isLoading) {
        updateWorkload.mutate(
          {
            id: workload?.id || 0,
            data: {
              device: settings.embeddingDevice,
              model: settings.embeddingModel.value,
              metadata: {
                rerankerModel: settings.rerankerModel.value,
                rerankerDevice: settings.rerankerDevice,
              },
              status: workload?.status === 'active' ? 'restart' : 'inactive',
            },
          },
          {
            onSuccess: () => resolve(),
            onError: () => resolve(),
          },
        )
      } else {
        resolve()
      }
    })
  }

  const SettingsButton = () => {
    return (
      <Button
        variant="secondary"
        size="icon"
        className="size-8"
        onClick={onOpen}
      >
        <Settings />
      </Button>
    )
  }

  return (
    <>
      <EmbeddingSettingsModal
        isOpen={isOpen}
        onClose={onClose}
        selectedEmbeddingModel={workload?.model || EMBEDDING_WORKLOAD.model}
        selectedEmbeddingDevice={workload?.device || EMBEDDING_WORKLOAD.device}
        selectedRerankerModel={
          workload?.metadata?.rerankerModel ||
          EMBEDDING_WORKLOAD.metadata.rerankerModel
        }
        selectedRerankerDevice={
          workload?.metadata?.rerankerDevice ||
          EMBEDDING_WORKLOAD.metadata.rerankerDevice
        }
        availableEmbeddingModels={EMBEDDING_MODELS}
        availableRerankerModels={EMBEDDING_RERANKER_MODELS}
        updateSettings={updateSettings}
      />
      <WorkloadComponent
        title="Embedding"
        settingsButton={<SettingsButton />}
        workload={workload}
        description={DESCRIPTION}
        workloadType={TYPE}
        demoElement={
          <EmbeddingDemo
            disabled={!workload || workload.status !== 'active'}
            model={workload?.model || undefined}
          />
        }
        docsElement={<DocumentationTemplate data={data} />}
        logsElement={<Logs name={`${workload?.name}_${workload?.id}`} />}
        isLoading={isLoading}
      />
    </>
  )
}
