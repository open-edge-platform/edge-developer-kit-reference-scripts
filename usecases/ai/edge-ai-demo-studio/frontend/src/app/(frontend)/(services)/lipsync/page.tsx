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

import Endpoint from '@/components/workloads/endpoint'
import LipsyncDemo from '@/components/workloads/lipsync/demo'
import LipsyncDocumentation from '@/components/workloads/lipsync/documentation'
import { lipsyncEndpoints } from '@/components/workloads/lipsync/api'
import {
  LIPSYNC_TYPE,
  LIPSYNC_DESCRIPTION,
  LIPSYNC_WORKLOAD,
  LIPSYNC_URL,
} from '@/lib/workloads/lipsync'
import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'
import useDisclosure from '@/hooks/use-disclosure'
import { SettingsModal } from '@/components/workloads/lipsync/settings'
import { useMemo } from 'react'
import { DocumentationProps, LipsyncSettings } from '@/types/workload'
import { getBaseURL } from '@/utils/common'

const TYPE = LIPSYNC_TYPE
const DESCRIPTION = LIPSYNC_DESCRIPTION

export default function LipsyncPage() {
  const url = getBaseURL(LIPSYNC_URL)

  const { data: workload, isLoading } = useGetWorkloadByType(TYPE)
  const { isOpen, onClose, onOpen } = useDisclosure()
  const updateWorkload = useUpdateWorkload()
  const createWorkload = useCreateWorkload()
  const workloadModel = useMemo(() => {
    return workload?.models.default ?? LIPSYNC_WORKLOAD.models.default
  }, [workload?.models.default])

  const data: DocumentationProps = {
    overview: <LipsyncDocumentation url={url} />,
    endpoints: <Endpoint apis={lipsyncEndpoints} url={url} />,
  }

  // Derive reset key from workload id and status to force re-render when needed
  const resetKey = `${workload?.id ?? 'no-id'}-${workload?.status ?? 'no-status'}`

  // Use explicit fallback for Coverity static analysis
  const currentWorkload = workload ?? LIPSYNC_WORKLOAD
  const updateSettings = (settings: LipsyncSettings) => {
    const { turnServerIp, model } = settings
    return new Promise<void>((resolve) => {
      if (!workload) {
        createWorkload.mutate(
          {
            ...LIPSYNC_WORKLOAD,
            models: { default: { ...model } },
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
              status: workload?.status === 'active' ? 'restart' : 'inactive',
              metadata: { turnServerIp },
              models: { default: { ...model } },
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

  return (
    <>
      <SettingsModal
        isOpen={isOpen}
        onClose={onClose}
        updateSettings={updateSettings}
        currentSettings={{
          turnServerIp: currentWorkload.metadata?.turnServerIp ?? '',
          model: workloadModel || LIPSYNC_WORKLOAD.models.default,
        }}
      />
      <WorkloadComponent
        title="Lipsync"
        workload={workload}
        description={DESCRIPTION}
        workloadType={TYPE}
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
          <LipsyncDemo
            key={resetKey}
            disabled={!workload || workload.status !== 'active'}
            turnServerIp={currentWorkload.metadata?.turnServerIp ?? ''}
          />
        }
        docsElement={<DocumentationTemplate data={data} />}
        logsElement={
          <Logs
            id={workload?.id || 0}
            type={workload?.type || LIPSYNC_TYPE}
            engine={workload?.engine ?? 'custom'}
          />
        }
        isLoading={isLoading}
      />
    </>
  )
}
