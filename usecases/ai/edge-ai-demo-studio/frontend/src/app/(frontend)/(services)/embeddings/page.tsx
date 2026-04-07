// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

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
import { useCallback } from 'react'

import useDisclosure from '@/hooks/use-disclosure'
import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'
import {
  EMBEDDING_TYPE,
  EMBEDDING_DESCRIPTION,
  EMBEDDING_WORKLOAD,
  EMBEDDING_URL,
  EMBEDDING_ENGINES,
} from '@/lib/workloads/embedding'
import Endpoint from '@/components/workloads/endpoint'
import { DocumentationProps, EmbeddingSettings } from '@/types/workload'
import { EmbeddingSettingsModal } from '@/components/workloads/embedding/settings'
import { DocumentationTemplate } from '@/components/workloads/documentation'
import {
  constructModelData,
  getBaseURL,
  getModelNameWithPrefix,
} from '@/utils/common'

const TYPE = EMBEDDING_TYPE
const DESCRIPTION = EMBEDDING_DESCRIPTION

const SettingsButton = ({ onOpen }: { onOpen: () => void }) => {
  return (
    <Button
      variant="secondary"
      size="icon"
      className="size-8"
      onClick={onOpen}
      data-testid="workload-settings-button"
    >
      <Settings />
    </Button>
  )
}

export default function EmbeddingPage() {
  const { data: workload, isLoading } = useGetWorkloadByType(EMBEDDING_TYPE)
  const { isOpen, onClose, onOpen } = useDisclosure()
  const url = getBaseURL(EMBEDDING_URL)

  const updateWorkload = useUpdateWorkload()
  const createWorkload = useCreateWorkload()
  const getWorkloadModel = useCallback(
    (key: string) => {
      return workload?.models?.[key] || EMBEDDING_WORKLOAD.models[key]
    },
    [workload?.models],
  )

  const getWorkloadModelName = useCallback(
    (key: string) => {
      const model = getWorkloadModel(key)
      return getModelNameWithPrefix(
        workload?.engine || EMBEDDING_WORKLOAD.engine,
        model,
      )
    },
    [getWorkloadModel, workload?.engine],
  )

  const data: DocumentationProps = {
    overview: (
      <EmbeddingDocumentation
        url={url}
        models={{
          default: getWorkloadModelName('default'),
          rerank: getWorkloadModelName('rerank'),
        }}
      />
    ),
    endpoints: <Endpoint apis={embeddingEndpoints} url={url} />,
  }

  const updateSettings = (settings: EmbeddingSettings) => {
    return new Promise<void>((resolve) => {
      const { embeddingModel, rerankerModel } = settings

      if (!workload) {
        createWorkload.mutate(
          {
            ...EMBEDDING_WORKLOAD,
            models: {
              default: constructModelData(embeddingModel),
              rerank: constructModelData(rerankerModel),
            },
            engine: settings.engine,
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
              models: {
                default: constructModelData(embeddingModel),
                rerank: constructModelData(rerankerModel),
              },
              engine: settings.engine,
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

  return (
    <>
      <EmbeddingSettingsModal
        isOpen={isOpen}
        onClose={onClose}
        currentSettings={{
          engine: workload?.engine || EMBEDDING_WORKLOAD.engine,
          embeddingModel: getWorkloadModel('default'),
          rerankerModel: getWorkloadModel('rerank'),
        }}
        updateSettings={updateSettings}
        engines={EMBEDDING_ENGINES}
      />
      <WorkloadComponent
        title="Embedding"
        settingsButton={<SettingsButton onOpen={onOpen} />}
        workload={workload}
        description={DESCRIPTION}
        workloadType={TYPE}
        demoElement={
          <EmbeddingDemo
            disabled={!workload || workload.status !== 'active'}
            model={getWorkloadModelName('default')}
          />
        }
        docsElement={<DocumentationTemplate data={data} />}
        logsElement={
          <Logs
            type={workload?.type || EMBEDDING_TYPE}
            engine={workload?.engine ?? 'custom'}
            status={workload?.status}
          />
        }
        isLoading={isLoading}
      />
    </>
  )
}
