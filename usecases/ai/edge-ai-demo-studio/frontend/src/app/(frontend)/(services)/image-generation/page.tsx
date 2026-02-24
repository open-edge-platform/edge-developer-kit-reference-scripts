// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { DocumentationTemplate } from '@/components/workloads/documentation'
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
import { SettingsModal } from '@/components/workloads/image-generation/settings'
import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'
import {
  IMAGE_GENERATION_WORKLOAD,
  IMAGE_GENERATION_TYPE,
  IMAGE_GENERATION_DESCRIPTION,
  IMAGE_GENERATION_MODELS,
  IMAGE_GENERATION_URL,
} from '@/lib/workloads/image-generation'
import Endpoint from '@/components/workloads/endpoint'
import { DocumentationProps, ImageGenerationSettings } from '@/types/workload'
import { getBaseURL } from '@/utils/common'

const TYPE = IMAGE_GENERATION_TYPE
const DESCRIPTION = IMAGE_GENERATION_DESCRIPTION

export default function ImageGenerationPage() {
  const { data: workload, isLoading } = useGetWorkloadByType(
    IMAGE_GENERATION_TYPE,
  )
  const { isOpen, onClose, onOpen } = useDisclosure()
  const url = getBaseURL(IMAGE_GENERATION_URL)

  const updateWorkload = useUpdateWorkload()
  const createWorkload = useCreateWorkload()

  const workloadModel = useMemo(() => {
    return workload?.models.default ?? IMAGE_GENERATION_MODELS[0]
  }, [workload?.models.default])
  const modelName = useMemo(() => {
    return workloadModel.name
  }, [workloadModel])

  const data: DocumentationProps = {
    overview: <ImageGenerationDocumentation url={url} model={modelName} />,
    endpoints: <Endpoint apis={imageGenerationEndpoints} url={url} />,
  }

  const updateSettings = (settings: ImageGenerationSettings) => {
    return new Promise((resolve) => {
      if (!workload) {
        createWorkload.mutate(
          {
            ...IMAGE_GENERATION_WORKLOAD,
            models: { default: settings.model },
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
              models: { default: settings.model },
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

  return (
    <>
      <SettingsModal
        task="Image Generation"
        isOpen={isOpen}
        onClose={onClose}
        availableModels={IMAGE_GENERATION_MODELS}
        updateSettings={updateSettings}
        currentSettings={{ model: workloadModel }}
      />
      <WorkloadComponent
        title="Image Generation"
        settingsButton={
          <Button
            variant="secondary"
            size="icon"
            className="size-8"
            onClick={onOpen}
          >
            <Settings />
          </Button>
        }
        workload={workload}
        description={DESCRIPTION}
        workloadType={TYPE}
        demoElement={
          <ImageGenerationDemo
            disabled={!workload || workload.status !== 'active'}
            selectedModel={workloadModel.name}
          />
        }
        docsElement={<DocumentationTemplate data={data} />}
        logsElement={
          <Logs
            id={workload?.id || 0}
            type={workload?.type || IMAGE_GENERATION_TYPE}
            engine={workload?.engine ?? 'custom'}
          />
        }
        isLoading={isLoading}
      />
    </>
  )
}
