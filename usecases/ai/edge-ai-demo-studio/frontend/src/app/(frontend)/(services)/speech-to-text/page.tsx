// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { DocumentationTemplate } from '@/components/workloads/documentation'
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
import { SettingsModal } from '@/components/workloads/speech-to-text/settings'
import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'
import {
  SPEECH_TO_TEXT_WORKLOAD,
  SPEECH_TO_TEXT_TYPE,
  SPEECH_TO_TEXT_DESCRIPTION,
  SPEECH_TO_TEXT_MODELS,
  STT_DENOISE_MODELS,
  SPEECH_TO_TEXT_URL,
} from '@/lib/workloads/speech-to-text'
import Endpoint from '@/components/workloads/endpoint'
import { DocumentationProps, SpeechToTextSettings } from '@/types/workload'
import { getBaseURL } from '@/utils/common'
import { useMemo } from 'react'

const TYPE = SPEECH_TO_TEXT_TYPE
const DESCRIPTION = SPEECH_TO_TEXT_DESCRIPTION

export default function SpeechToTextPage() {
  const { data: workload, isLoading } =
    useGetWorkloadByType(SPEECH_TO_TEXT_TYPE)
  const { isOpen, onClose, onOpen } = useDisclosure()
  const url = getBaseURL(SPEECH_TO_TEXT_URL)

  const updateWorkload = useUpdateWorkload()
  const createWorkload = useCreateWorkload()

  const workloadModel = useMemo(() => {
    return workload?.models.default ?? SPEECH_TO_TEXT_WORKLOAD.models.default
  }, [workload?.models.default])
  const workloadDenoiseModel = useMemo(() => {
    return workload?.models.denoise ?? SPEECH_TO_TEXT_WORKLOAD.models.denoise
  }, [workload?.models.denoise])

  const data: DocumentationProps = {
    overview: <SpeechToTextDocumentation url={url} />,
    endpoints: <Endpoint apis={speechToTextEndpoints} url={url} />,
  }

  const updateSettings = (settings: SpeechToTextSettings) => {
    const { sttModel, denoiseModel } = settings
    return new Promise((resolve) => {
      if (!workload) {
        createWorkload.mutate(
          {
            ...SPEECH_TO_TEXT_WORKLOAD,
            models: {
              default: sttModel,
              denoise: denoiseModel,
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
              models: {
                default: sttModel,
                denoise: denoiseModel,
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
        availableModels={{
          stt: SPEECH_TO_TEXT_MODELS,
          denoise: STT_DENOISE_MODELS,
        }}
        updateSettings={updateSettings}
        currentSettings={{
          sttModel: workloadModel,
          denoiseModel: workloadDenoiseModel,
        }}
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
        logsElement={
          <Logs
            id={workload?.id || 0}
            type={workload?.type || SPEECH_TO_TEXT_TYPE}
            engine={workload?.engine ?? 'custom'}
          />
        }
        isLoading={isLoading}
      />
    </>
  )
}
