// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  AlertCircleIcon,
  Code,
  Loader2,
  Logs,
  Play,
  Power,
  PowerOff,
} from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import React, { useCallback, useMemo } from 'react'
import { Button } from '../ui/button'
import {
  useCreateWorkload,
  useGetWorkloadsStatus,
  useUpdateWorkload,
} from '@/hooks/use-workload'
import type { Workload } from '@/payload-types'
import { getDefaultWorkload, statusMap } from '@/utils/common'
import { Alert, AlertDescription, AlertTitle } from '../ui/alert'
import { toast } from 'sonner'
import {
  getInactivePrerequisites,
  getPreparingPrerequisites,
  getActiveWorkloadInactivePrerequisites,
  startPrerequisites,
} from '@/utils/prerequisite-utils'

export default function Workload({
  title,
  workload,
  demoElement,
  docsElement,
  logsElement,
  isLoading,
  settingsButton,
  workloadType,
  prerequisiteServices,
}: {
  title: string
  workload?: Workload
  workloadType: Workload['type']
  description: string
  demoElement: React.ReactNode
  docsElement: React.ReactNode
  logsElement: React.ReactNode
  settingsButton?: React.ReactNode
  isLoading: boolean
  prerequisiteServices?: string[]
}) {
  const createWorkload = useCreateWorkload()
  const updateWorkload = useUpdateWorkload()

  const { data: workloads } = useGetWorkloadsStatus()

  const inactivePrerequisites = useMemo(
    () => getInactivePrerequisites(prerequisiteServices, workloads),
    [prerequisiteServices, workloads],
  )

  const preparingPrerequisites = useMemo(
    () => getPreparingPrerequisites(prerequisiteServices, workloads),
    [prerequisiteServices, workloads],
  )

  const activeWorkloadInactivePrerequisites = useMemo(
    () =>
      getActiveWorkloadInactivePrerequisites(
        workload,
        prerequisiteServices,
        workloads,
      ),
    [workload, prerequisiteServices, workloads],
  )

  const status = useMemo(() => {
    if (workload && workload.status) {
      return (
        statusMap[workload.status] || {
          status: 'Unknown',
          color: 'bg-gray-300',
        }
      )
    }

    return statusMap.inactive
  }, [workload])

  const preparePrerequisite = useCallback(() => {
    startPrerequisites(
      prerequisiteServices,
      workloads,
      createWorkload,
      updateWorkload,
    )
  }, [createWorkload, prerequisiteServices, updateWorkload, workloads])

  const toggleService = () => {
    if (!workload) {
      preparePrerequisite()
      const defaultWorkload = getDefaultWorkload(workloadType)
      if (defaultWorkload) {
        createWorkload.mutate({ ...defaultWorkload })
      } else {
        toast.error(
          'Unable to create workload: Default configuration not found.',
        )
      }
    } else {
      let status: Workload['status'] = 'prepare'
      if (workload.status === 'active') {
        status = 'inactive'
      }

      if (
        status === 'prepare' &&
        prerequisiteServices &&
        prerequisiteServices.length > 0
      ) {
        preparePrerequisite()
      }

      updateWorkload.mutate({
        id: workload.id,
        data: { status },
      })
    }
  }

  return (
    <>
      <div className="w-full py-8">
        <div className="mb-8 flex w-full items-center justify-between gap-4 px-6">
          {/* Header */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-slate-900">{title}</span>
            </div>

            {!isLoading && (
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${status.color}`} />
                <span className="text-sm text-slate-600">{status.status}</span>
                {workload?.status === 'active' && !workload?.isHealthy && (
                  <div className="flex items-center gap-1 rounded-md bg-red-100 px-2 py-1">
                    <div className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    <span className="text-xs font-medium text-red-700">
                      Unhealthy
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {settingsButton}

            <Button
              size="sm"
              onClick={toggleService}
              className="ml-2"
              variant={
                workload && workload.status === 'active'
                  ? 'destructive'
                  : 'default'
              }
              disabled={
                (workload &&
                  (workload.status === 'prepare' ||
                    workload.status === 'restart')) ||
                createWorkload.isPending ||
                updateWorkload.isPending ||
                isLoading ||
                (preparingPrerequisites && preparingPrerequisites.length > 0)
              }
            >
              {createWorkload.isPending ||
              updateWorkload.isPending ||
              isLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : workload && workload.status === 'active' ? (
                <PowerOff className="mr-1 h-4 w-4" />
              ) : (
                <Power className="mr-1 h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Main Tabs */}
        <Tabs defaultValue="demo" className="w-full">
          <TabsList className="mb-8 grid w-full grid-cols-3">
            <TabsTrigger value="demo" className="flex items-center gap-2">
              <Play className="h-4 w-4" />
              Live Demo
            </TabsTrigger>
            <TabsTrigger value="docs" className="flex items-center gap-2">
              <Code className="h-4 w-4" />
              Documentation
            </TabsTrigger>
            <TabsTrigger value="logs" className="flex items-center gap-2">
              <Logs className="h-4 w-4" />
              Logs
            </TabsTrigger>
          </TabsList>
          <TabsContent value="demo" className="space-y-6">
            {!isLoading &&
              inactivePrerequisites &&
              inactivePrerequisites.length > 0 && (
                <Alert
                  variant="default"
                  className="border-orange-200 bg-orange-50"
                >
                  <AlertCircleIcon className="text-orange-600" />
                  <AlertTitle className="text-orange-800">
                    Prerequisites Required
                  </AlertTitle>
                  <AlertDescription className="text-orange-700">
                    This workload requires the following services to be active:{' '}
                    <strong>{inactivePrerequisites.join(', ')}</strong> Turning
                    on this workload will automatically start these services
                    with default configurations.
                  </AlertDescription>
                </Alert>
              )}
            {!isLoading &&
              preparingPrerequisites &&
              preparingPrerequisites.length > 0 && (
                <Alert variant="default" className="border-blue-200 bg-blue-50">
                  <AlertCircleIcon className="text-blue-600" />
                  <AlertTitle className="text-blue-800">
                    Prerequisites Starting
                  </AlertTitle>
                  <AlertDescription className="text-blue-700">
                    The following prerequisite services are currently starting:{' '}
                    <strong>{preparingPrerequisites.join(', ')}</strong>. Please
                    wait for them to finish before enabling this workload.
                  </AlertDescription>
                </Alert>
              )}
            {!isLoading &&
              activeWorkloadInactivePrerequisites &&
              activeWorkloadInactivePrerequisites.length > 0 && (
                <Alert
                  variant="destructive"
                  className="border-red-200 bg-red-50"
                >
                  <AlertCircleIcon className="text-red-600" />
                  <AlertTitle className="text-red-800">
                    Prerequisites Turned Off
                  </AlertTitle>
                  <AlertDescription className="text-red-700">
                    This workload is active but the following prerequisite
                    services are turned off:{' '}
                    <strong>
                      {activeWorkloadInactivePrerequisites.join(', ')}
                    </strong>
                    . This service might not work properly. Please ensure the
                    prerequisite services are running.
                  </AlertDescription>
                </Alert>
              )}
            {isLoading ||
            createWorkload.isPending ||
            updateWorkload.isPending ? (
              <Alert>
                <AlertCircleIcon />
                <AlertTitle>Loading</AlertTitle>
                <AlertDescription>
                  The service is currently Loading.
                </AlertDescription>
              </Alert>
            ) : (
              (!workload || (workload && workload.status !== 'active')) && (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertTitle>Unable to run demo</AlertTitle>
                  <AlertDescription>
                    The service is currently {status.status.toLowerCase()}.
                    {status.status === 'Preparing'
                      ? ' Please wait until it is ready.'
                      : ' Please enable it to run the demo.'}
                  </AlertDescription>
                </Alert>
              )
            )}
            {demoElement}
          </TabsContent>

          <TabsContent value="docs" className="space-y-6">
            {docsElement}
          </TabsContent>

          <TabsContent value="logs" className="space-y-6">
            {logsElement}
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}
