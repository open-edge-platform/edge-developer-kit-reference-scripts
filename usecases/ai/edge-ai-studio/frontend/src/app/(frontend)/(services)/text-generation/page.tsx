// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  DocumentationTemplate,
  DocumentationProps,
} from '@/components/workloads/documentation'
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
import {
  Model,
  SettingsModal,
} from '@/components/workloads/text-generation/settings'
import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'
import {
  TEXT_GENERATION_WORKLOAD,
  TEXT_GENERATION_TYPE,
  TEXT_GENERATION_DESCRIPTION,
  TEXT_GENERATION_MODELS,
} from '@/lib/workloads/text-generation'
import Endpoint from '@/components/workloads/endpoint'
import { TEXT_GENERATION_PORT } from '@/lib/constants'

const TYPE = TEXT_GENERATION_TYPE
const DESCRIPTION = TEXT_GENERATION_DESCRIPTION

export default function TextGenerationPage() {
  const { data: workload, isLoading } = useGetWorkloadByType('text-generation')
  const { isOpen, onClose, onOpen } = useDisclosure()

  const updateWorkload = useUpdateWorkload()
  const createWorkload = useCreateWorkload()

  const modelName = useMemo(() => {
    const model = workload?.model ?? TEXT_GENERATION_MODELS[0].value
    const parts = model.split('/')
    return parts.length > 1 ? parts[1] : model
  }, [workload?.model])

  const data: DocumentationProps = {
    overview: (
      <TextGenerationDocumentation
        port={workload?.port ?? TEXT_GENERATION_PORT}
        model={modelName}
      />
    ),
    endpoints: (
      <Endpoint
        apis={textGenerationEndpoints}
        port={workload?.port ?? TEXT_GENERATION_PORT}
      />
    ),
  }

  const updateSettings = (device: string, model: Model) => {
    return new Promise((resolve) => {
      if (!workload) {
        createWorkload.mutate(
          {
            ...TEXT_GENERATION_WORKLOAD,
            device,
            model: model.value,
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
              device,
              model: model.value,
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
      <SettingsModal
        task="Text Generation"
        isOpen={isOpen}
        onClose={onClose}
        availableModels={TEXT_GENERATION_MODELS}
        updateSettings={updateSettings}
        selectedDevice={workload?.device || TEXT_GENERATION_WORKLOAD.device}
        selectedModel={workload?.model || TEXT_GENERATION_WORKLOAD.model}
      />
      <WorkloadComponent
        title="Text Generation"
        settingsButton={<SettingsButton />}
        workload={workload}
        description={DESCRIPTION}
        workloadType={TYPE}
        demoElement={
          <TextGenerationDemo
            disabled={!workload || workload.status !== 'active'}
            selectedModel={workload?.model || TEXT_GENERATION_WORKLOAD.model}
          />
        }
        docsElement={<DocumentationTemplate data={data} />}
        logsElement={<Logs name={`${workload?.name}_${workload?.id}`} />}
        isLoading={isLoading}
      />
    </>
  )
}
