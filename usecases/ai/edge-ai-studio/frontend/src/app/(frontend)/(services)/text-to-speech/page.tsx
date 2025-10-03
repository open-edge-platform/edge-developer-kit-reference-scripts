// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  DocumentationTemplate,
  DocumentationProps,
} from '@/components/workloads/documentation'
import Logs from '@/components/workloads/log'
import WorkloadComponent from '@/components/workloads/workload'
import {
  useCreateWorkload,
  useGetWorkloadByType,
  useUpdateWorkload,
} from '@/hooks/use-workload'

import TextToSpeechDocumentation from '@/components/workloads/text-to-speech/documentation'
import {
  TEXT_TO_SPEECH_TYPE,
  TEXT_TO_SPEECH_DESCRIPTION,
  TEXT_TO_SPEECH_WORKLOAD,
} from '@/lib/workloads/text-to-speech'
import Endpoint from '@/components/workloads/endpoint'
import { textToSpeechEndpoints } from '@/components/workloads/text-to-speech/api'
import TextToSpeechDemo from '@/components/workloads/text-to-speech/demo'
import { TEXT_TO_SPEECH_PORT } from '@/lib/constants'
import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'
import useDisclosure from '@/hooks/use-disclosure'
import {
  SettingsModal,
  TTSSettings,
} from '@/components/workloads/text-to-speech/settings'

const TYPE = TEXT_TO_SPEECH_TYPE
const DESCRIPTION = TEXT_TO_SPEECH_DESCRIPTION

export default function TextToSpeechPage() {
  const { data: workload, isLoading } = useGetWorkloadByType('text-to-speech')
  const { isOpen, onClose, onOpen } = useDisclosure()
  const updateWorkload = useUpdateWorkload()
  const createWorkload = useCreateWorkload()

  const updateSettings = (settings: TTSSettings) => {
    return new Promise<void>((resolve) => {
      if (!workload) {
        createWorkload.mutate(
          {
            ...TEXT_TO_SPEECH_WORKLOAD,
            device: settings.device,
            model: settings.model,
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
              device: settings.device,
              model: settings.model,
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
  const data: DocumentationProps = {
    overview: (
      <TextToSpeechDocumentation port={workload?.port ?? TEXT_TO_SPEECH_PORT} />
    ),
    endpoints: (
      <Endpoint
        apis={textToSpeechEndpoints}
        port={workload?.port ?? TEXT_TO_SPEECH_PORT}
      />
    ),
  }

  return (
    <>
      <SettingsModal
        isOpen={isOpen}
        onClose={onClose}
        currentSettings={{
          device: workload?.device || TEXT_TO_SPEECH_WORKLOAD.device,
          model: workload?.model || TEXT_TO_SPEECH_WORKLOAD.model,
        }}
        updateSettings={updateSettings}
      />
      <WorkloadComponent
        title="Text-to-Speech"
        workload={workload}
        workloadType={TYPE}
        description={DESCRIPTION}
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
        demoElement={
          <TextToSpeechDemo
            workload={workload}
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
