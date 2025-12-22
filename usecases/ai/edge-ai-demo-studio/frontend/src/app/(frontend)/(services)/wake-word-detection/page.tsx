// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import WorkloadComponent from '@/components/workloads/workload'
import {
  useCreateWorkload,
  useGetWorkloadByType,
  useUpdateWorkload,
} from '@/hooks/use-workload'

import useDisclosure from '@/hooks/use-disclosure'
import {
  Model,
  SettingsModal,
} from '@/components/workloads/wake-word-detection/settings'
import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'
import {
  WAKE_WORD_DETECTION_WORKLOAD,
  WAKE_WORD_DETECTION_TYPE,
  WAKE_WORD_DETECTION_DESCRIPTION,
  WAKE_WORD_DETECTION_MODELS,
} from '@/lib/workloads/wake-word-detection'
import WakeWordDetectionDemo from '@/components/workloads/wake-word-detection/demo'
import Logs from '@/components/workloads/log'
import {
  DocumentationProps,
  DocumentationTemplate,
} from '@/components/workloads/documentation'
import WakeWordDetectionDocumentation from '@/components/workloads/wake-word-detection/documentation'
import { WAKE_WORD_DETECTION_PORT } from '@/lib/constants'
import Endpoint from '@/components/workloads/endpoint'
import { wakeWordDetectionEndpoints } from '@/components/workloads/wake-word-detection/api'

const TYPE = WAKE_WORD_DETECTION_TYPE
const DESCRIPTION = WAKE_WORD_DETECTION_DESCRIPTION

export default function TextGenerationPage() {
  const { data: workload, isLoading } = useGetWorkloadByType(
    'wake-word-detection',
  )
  const { isOpen, onClose, onOpen } = useDisclosure()

  const updateWorkload = useUpdateWorkload()
  const createWorkload = useCreateWorkload()

  const data: DocumentationProps = {
    overview: (
      <WakeWordDetectionDocumentation port={WAKE_WORD_DETECTION_PORT} />
    ),
    endpoints: (
      <Endpoint
        apis={wakeWordDetectionEndpoints}
        port={WAKE_WORD_DETECTION_PORT}
      />
    ),
  }

  const updateSettings = (models: Model[], vadThreshold: number) => {
    return new Promise((resolve, reject) => {
      const modelString = models.map((model) => model.value).join(' ')

      if (!workload) {
        createWorkload.mutate(
          {
            ...WAKE_WORD_DETECTION_WORKLOAD,
            model: modelString,
            metadata: {
              vadThreshold,
            },
            status: 'inactive',
          },
          {
            onSuccess: () => resolve(true),
            onError: (error) => {
              console.error('Failed to create workload:', error)
              reject(error)
            },
          },
        )
      } else if (workload && !isLoading) {
        updateWorkload.mutateAsync(
          {
            id: workload?.id || 0,
            data: {
              model: modelString,
              metadata: {
                vadThreshold,
              },
            },
          },
          {
            onSuccess: () => resolve(true),
            onError: (error) => {
              console.error('Failed to update workload:', error)
              reject(error)
            },
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
        task="Wake Word Detection"
        isOpen={isOpen}
        onClose={onClose}
        predefinedModels={WAKE_WORD_DETECTION_MODELS}
        updateSettings={updateSettings}
        selectedModel={workload?.model || WAKE_WORD_DETECTION_WORKLOAD.model}
        vadThreshold={
          workload?.metadata?.vadThreshold ??
          WAKE_WORD_DETECTION_WORKLOAD.metadata.vadThreshold
        }
        workloadStatus={workload?.status}
      />
      <WorkloadComponent
        title="Wake Word Detection"
        settingsButton={<SettingsButton />}
        workload={workload}
        description={DESCRIPTION}
        workloadType={TYPE}
        demoElement={
          <WakeWordDetectionDemo
            disabled={!workload || workload.status !== 'active'}
          />
        }
        docsElement={<DocumentationTemplate data={data} />}
        logsElement={<Logs name={`${workload?.name}_${workload?.id}`} />}
        isLoading={isLoading}
      />
    </>
  )
}
