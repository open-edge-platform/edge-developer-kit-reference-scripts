// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { DocumentationTemplate } from '@/components/workloads/documentation'
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
  TEXT_TO_SPEECH_URL,
} from '@/lib/workloads/text-to-speech'
import Endpoint from '@/components/workloads/endpoint'
import { textToSpeechEndpoints } from '@/components/workloads/text-to-speech/api'
import TextToSpeechDemo from '@/components/workloads/text-to-speech/demo'
import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'
import useDisclosure from '@/hooks/use-disclosure'
import { SettingsModal } from '@/components/workloads/text-to-speech/settings'
import { DocumentationProps, TTSSettings } from '@/types/workload'
import { getBaseURL } from '@/utils/common'
import { useMemo } from 'react'

const TYPE = TEXT_TO_SPEECH_TYPE
const DESCRIPTION = TEXT_TO_SPEECH_DESCRIPTION

export default function TextToSpeechPage() {
  const { data: workload, isLoading } = useGetWorkloadByType(TYPE)
  const url = getBaseURL(TEXT_TO_SPEECH_URL)
  const { isOpen, onClose, onOpen } = useDisclosure()
  const updateWorkload = useUpdateWorkload()
  const createWorkload = useCreateWorkload()

  const workloadModel = useMemo(() => {
    return workload?.models.default ?? TEXT_TO_SPEECH_WORKLOAD.models.default
  }, [workload?.models.default])

  const updateSettings = (settings: TTSSettings) => {
    return new Promise<void>((resolve) => {
      if (!workload) {
        createWorkload.mutate(
          {
            ...TEXT_TO_SPEECH_WORKLOAD,
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
              models: { default: settings.model },
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
    overview: <TextToSpeechDocumentation url={url} />,
    endpoints: <Endpoint apis={textToSpeechEndpoints} url={url} />,
  }

  return (
    <>
      <SettingsModal
        isOpen={isOpen}
        onClose={onClose}
        currentSettings={{
          model: workloadModel,
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
        logsElement={
          <Logs
            id={workload?.id || 0}
            type={workload?.type || TEXT_TO_SPEECH_TYPE}
            engine={workload?.engine ?? 'custom'}
          />
        }
        isLoading={isLoading}
      />
    </>
  )
}
