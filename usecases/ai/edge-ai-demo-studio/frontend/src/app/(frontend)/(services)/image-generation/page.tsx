// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  DocumentationTemplate,
  DocumentationProps,
} from '@/components/workloads/documentation'
import Logs from '@/components/workloads/log'
import { imageGenerationEndpoints } from '@/components/workloads/image-generation/api'
import ImageGenerationDemo from '@/components/workloads/image-generation/demo'
import ImageGenerationDocumentation from '@/components/workloads/image-generation/documentation'
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
} from '@/components/workloads/image-generation/settings'
import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'
import {
  IMAGE_GENERATION_WORKLOAD,
  IMAGE_GENERATION_TYPE,
  IMAGE_GENERATION_DESCRIPTION,
  IMAGE_GENERATION_MODELS,
} from '@/lib/workloads/image-generation'
import Endpoint from '@/components/workloads/endpoint'
import { IMAGE_GENERATION_PORT } from '@/lib/constants'

const TYPE = IMAGE_GENERATION_TYPE
const DESCRIPTION = IMAGE_GENERATION_DESCRIPTION

export default function ImageGenerationPage() {
  const { data: workload, isLoading } = useGetWorkloadByType('image-generation')
  const { isOpen, onClose, onOpen } = useDisclosure()

  const updateWorkload = useUpdateWorkload()
  const createWorkload = useCreateWorkload()

  const modelName = useMemo(() => {
    return workload?.model ?? IMAGE_GENERATION_MODELS[0].value
  }, [workload?.model])

  const data: DocumentationProps = {
    overview: (
      <ImageGenerationDocumentation
        port={workload?.port ?? IMAGE_GENERATION_PORT}
        model={modelName}
      />
    ),
    endpoints: (
      <Endpoint
        apis={imageGenerationEndpoints}
        port={workload?.port ?? IMAGE_GENERATION_PORT}
      />
    ),
  }

  const updateSettings = (device: string, model: Model) => {
    return new Promise((resolve) => {
      if (!workload) {
        createWorkload.mutate(
          {
            ...IMAGE_GENERATION_WORKLOAD,
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
        task="Image Generation"
        isOpen={isOpen}
        onClose={onClose}
        availableModels={IMAGE_GENERATION_MODELS}
        updateSettings={updateSettings}
        selectedDevice={workload?.device || IMAGE_GENERATION_WORKLOAD.device}
        selectedModel={workload?.model || IMAGE_GENERATION_WORKLOAD.model}
      />
      <WorkloadComponent
        title="Image Generation"
        settingsButton={<SettingsButton />}
        workload={workload}
        description={DESCRIPTION}
        workloadType={TYPE}
        demoElement={
          <ImageGenerationDemo
            disabled={!workload || workload.status !== 'active'}
            selectedModel={workload?.model || IMAGE_GENERATION_WORKLOAD.model}
          />
        }
        docsElement={<DocumentationTemplate data={data} />}
        logsElement={<Logs name={`${workload?.name}_${workload?.id}`} />}
        isLoading={isLoading}
      />
    </>
  )
}
