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

import Endpoint from '@/components/workloads/endpoint'
import LipsyncDemo from '@/components/workloads/lipsync/demo'
import LipsyncDocumentation from '@/components/workloads/lipsync/documentation'
import { lipsyncEndpoints } from '@/components/workloads/lipsync/api'
import { LIPSYNC_PORT } from '@/lib/constants'
import {
  LIPSYNC_TYPE,
  LIPSYNC_DESCRIPTION,
  LIPSYNC_WORKLOAD,
} from '@/lib/workloads/lipsync'
import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'
import useDisclosure from '@/hooks/use-disclosure'
import { SettingsModal } from '@/components/workloads/lipsync/settings'
import { useEffect, useState } from 'react'

const TYPE = LIPSYNC_TYPE
const DESCRIPTION = LIPSYNC_DESCRIPTION

export default function LipsyncPage() {
  const [resetIndex, setResetIndex] = useState(0)

  const { data: workload, isLoading } = useGetWorkloadByType(TYPE)
  const { data: ttsWorkload } = useGetWorkloadByType('text-to-speech')
  const { isOpen, onClose, onOpen } = useDisclosure()
  const updateWorkload = useUpdateWorkload()
  const createWorkload = useCreateWorkload()

  const data: DocumentationProps = {
    overview: <LipsyncDocumentation port={LIPSYNC_PORT} />,
    endpoints: <Endpoint apis={lipsyncEndpoints} port={LIPSYNC_PORT} />,
  }

  useEffect(() => {
    if (workload?.status !== 'active') {
      setResetIndex((prev) => prev + 1)
    }
  }, [workload])

  const updateSettings = (device: string, turnServerIp: string) => {
    return new Promise<void>((resolve) => {
      if (!workload) {
        createWorkload.mutate(
          {
            ...LIPSYNC_WORKLOAD,
            device,
            status: 'inactive',
            metadata: { turnServerIp },
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
              device,
              status: workload?.status === 'active' ? 'restart' : 'inactive',
              metadata: { turnServerIp },
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
        isOpen={isOpen}
        onClose={onClose}
        updateSettings={updateSettings}
        selectedDevice={workload?.device || LIPSYNC_WORKLOAD.device}
        turnServerIp={
          workload?.metadata?.turnServerIp ??
          LIPSYNC_WORKLOAD.metadata.turnServerIp
        }
      />
      <WorkloadComponent
        title="Lipsync"
        workload={workload}
        description={DESCRIPTION}
        workloadType={TYPE}
        settingsButton={<SettingsButton />}
        demoElement={
          <LipsyncDemo
            key={resetIndex}
            disabled={!workload || workload.status !== 'active'}
            turnServerIp={
              workload?.metadata?.turnServerIp ??
              LIPSYNC_WORKLOAD.metadata.turnServerIp
            }
          />
        }
        docsElement={<DocumentationTemplate data={data} />}
        logsElement={<Logs name={`${workload?.name}_${workload?.id}`} />}
        isLoading={isLoading}
      />
    </>
  )
}
