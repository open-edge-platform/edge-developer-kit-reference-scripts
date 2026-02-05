// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { DocumentationTemplate } from '@/components/workloads/documentation'
import Logs from '@/components/workloads/log'
import { textGenerationEndpoints } from '@/components/workloads/text-generation/api'
import TextGenerationDemo from '@/components/workloads/text-generation/demo'
import TextGenerationDocumentation from '@/components/workloads/text-generation/documentation'
import WorkloadComponent from '@/components/workloads/workload'
import {
  useCreateWorkload,
  useGetWorkloadByType,
  useUpdateWorkload,
} from '@/hooks/use-workload'
import { useMemo } from 'react'

import useDisclosure from '@/hooks/use-disclosure'
import { SettingsModal } from '@/components/workloads/text-generation/settings'
import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'
import {
  TEXT_GENERATION_WORKLOAD,
  TEXT_GENERATION_TYPE,
  TEXT_GENERATION_DESCRIPTION,
  TEXT_GENERATION_ENGINES,
  TEXT_GENERATION_URL,
} from '@/lib/workloads/text-generation'
import Endpoint from '@/components/workloads/endpoint'
import { DocumentationProps, TextGenerationSettings } from '@/types/workload'
import {
  constructModelData,
  getBaseURL,
  getModelNameWithPrefix,
} from '@/utils/common'

const TYPE = TEXT_GENERATION_TYPE
const DESCRIPTION = TEXT_GENERATION_DESCRIPTION

export default function TextGenerationPage() {
  const { data: workload, isLoading } =
    useGetWorkloadByType(TEXT_GENERATION_TYPE)
  const { isOpen, onClose, onOpen } = useDisclosure()
  const url = getBaseURL(TEXT_GENERATION_URL)

  const updateWorkload = useUpdateWorkload()
  const createWorkload = useCreateWorkload()

  const workloadModel = useMemo(() => {
    return workload?.models?.default || TEXT_GENERATION_WORKLOAD.models.default
  }, [workload?.models])

  const modelName = useMemo(() => {
    return getModelNameWithPrefix(
      workload?.engine || TEXT_GENERATION_WORKLOAD.engine,
      workloadModel,
    )
  }, [workloadModel, workload?.engine])

  const data: DocumentationProps = {
    overview: <TextGenerationDocumentation url={url} model={modelName} />,
    endpoints: <Endpoint apis={textGenerationEndpoints} url={url} />,
  }

  const updateSettings = (settings: TextGenerationSettings) => {
    const { model, engine } = settings
    return new Promise((resolve) => {
      const modelData = constructModelData(model)

      if (!workload) {
        createWorkload.mutate(
          {
            ...TEXT_GENERATION_WORKLOAD,
            models: { default: modelData },
            engine,
            status: 'inactive',
          },
          {
            onSuccess: () => resolve(true),
            onError: () => resolve(true),
          },
        )
      } else if (workload && !isLoading) {
        updateWorkload.mutateAsync(
          {
            id: workload?.id || 0,
            data: {
              models: { default: modelData },
              engine,
              status: workload?.status === 'active' ? 'restart' : 'inactive',
            },
          },
          {
            onSuccess: () => resolve(true),
            onError: () => resolve(true),
          },
        )
      } else {
        resolve(true)
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
      {!isLoading && (
        <SettingsModal
          task="Text Generation"
          isOpen={isOpen}
          onClose={onClose}
          updateSettings={updateSettings}
          currentSettings={{
            model: workloadModel,
            engine: workload?.engine || TEXT_GENERATION_WORKLOAD.engine,
          }}
          engines={TEXT_GENERATION_ENGINES}
        />
      )}

      <WorkloadComponent
        title="Text Generation"
        settingsButton={<SettingsButton />}
        workload={workload}
        description={DESCRIPTION}
        workloadType={TYPE}
        demoElement={
          <TextGenerationDemo
            disabled={!workload || workload.status !== 'active'}
            selectedModel={modelName}
          />
        }
        docsElement={<DocumentationTemplate data={data} />}
        logsElement={
          <Logs
            id={workload?.id || 0}
            type={workload?.type || TEXT_GENERATION_TYPE}
            engine={workload?.engine ?? TEXT_GENERATION_WORKLOAD.engine}
          />
        }
        isLoading={isLoading}
      />
    </>
  )
}
