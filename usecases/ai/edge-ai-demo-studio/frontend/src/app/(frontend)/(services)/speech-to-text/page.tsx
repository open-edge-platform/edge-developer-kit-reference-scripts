// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  DocumentationTemplate,
  DocumentationProps,
} from '@/components/workloads/documentation'
import Logs from '@/components/workloads/log'
import { speechToTextEndpoints } from '@/components/workloads/speech-to-text/api'
import SpeechToTextDemo from '@/components/workloads/speech-to-text/demo'
import SpeechToTextDocumentation from '@/components/workloads/speech-to-text/documentation'
import WorkloadComponent from '@/components/workloads/workload'
import {
  useCreateWorkload,
  useGetWorkloadByType,
  useUpdateWorkload,
} from '@/hooks/use-workload'

import useDisclosure from '@/hooks/use-disclosure'
import {
  SettingsModal,
  SpeechToTextSettings,
} from '@/components/workloads/speech-to-text/settings'
import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'
import {
  SPEECH_TO_TEXT_WORKLOAD,
  SPEECH_TO_TEXT_TYPE,
  SPEECH_TO_TEXT_DESCRIPTION,
  SPEECH_TO_TEXT_MODELS,
  STT_DENOISE_MODELS,
} from '@/lib/workloads/speech-to-text'
import Endpoint from '@/components/workloads/endpoint'
import { SPEECH_TO_TEXT_PORT } from '@/lib/constants'

const TYPE = SPEECH_TO_TEXT_TYPE
const DESCRIPTION = SPEECH_TO_TEXT_DESCRIPTION

export default function SpeechToTextPage() {
  const { data: workload, isLoading } = useGetWorkloadByType('speech-to-text')
  const { isOpen, onClose, onOpen } = useDisclosure()

  const updateWorkload = useUpdateWorkload()
  const createWorkload = useCreateWorkload()

  const data: DocumentationProps = {
    overview: (
      <SpeechToTextDocumentation port={workload?.port ?? SPEECH_TO_TEXT_PORT} />
    ),
    endpoints: (
      <Endpoint
        apis={speechToTextEndpoints}
        port={workload?.port ?? SPEECH_TO_TEXT_PORT}
      />
    ),
  }

  const updateSettings = (settings: SpeechToTextSettings) => {
    return new Promise((resolve) => {
      if (!workload) {
        createWorkload.mutate(
          {
            ...SPEECH_TO_TEXT_WORKLOAD,
            device: settings.sttDevice,
            model: settings.sttModel.value,
            metadata: {
              denoise_model: settings.denoiseModel.value,
              denoise_device: settings.denoiseDevice,
            },
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
              device: settings.sttDevice,
              model: settings.sttModel.value,
              metadata: {
                denoise_model: settings.denoiseModel.value,
                denoise_device: settings.denoiseDevice,
              },
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
        task="Speech-to-Text"
        isOpen={isOpen}
        onClose={onClose}
        availableSTTModels={SPEECH_TO_TEXT_MODELS}
        availableDenoiseModels={STT_DENOISE_MODELS}
        updateSettings={updateSettings}
        selectedSTTModel={workload?.model || SPEECH_TO_TEXT_WORKLOAD.model}
        selectedSTTDevice={workload?.device || SPEECH_TO_TEXT_WORKLOAD.device}
        selectedDenoiseModel={
          workload?.metadata?.denoise_model ||
          SPEECH_TO_TEXT_WORKLOAD.metadata.denoise_model
        }
        selectedDenoiseDevice={
          workload?.metadata?.denoise_device ||
          SPEECH_TO_TEXT_WORKLOAD.metadata.denoise_device
        }
      />
      <WorkloadComponent
        title="Speech-to-Text"
        settingsButton={<SettingsButton />}
        workload={workload}
        description={DESCRIPTION}
        workloadType={TYPE}
        demoElement={
          <SpeechToTextDemo
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
