// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { requireApiBase } from '@/lib/browser/api-base'
import { useJobRun } from '@/services/common/jobs/use-job-run'
import {
  type DeployPhase,
  fetchModels,
  type GetiConnection,
  type GetiProject,
  SERVICE_NAME,
  type SetupResult,
  setupJob,
} from '../lib/api'
import { healthKey } from './use-geti-api'

interface UsePhaseSetupOptions {
  apiBase: string | undefined
  connection: GetiConnection
  /** The server's projects, once connected. */
  projects: GetiProject[]
  /** Device to use while the user hasn't picked one for this phase yet. */
  defaultDevice: string
}

/** One phase's half of the settings wizard: project, model version, device and deploy job. */
export function usePhaseSetup(
  phase: DeployPhase,
  { apiBase, connection, projects, defaultDevice }: UsePhaseSetupOptions,
) {
  const queryClient = useQueryClient()
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('latest')
  const [chosenDevice, setSelectedDevice] = useState('')

  const models = useMutation({
    mutationFn: (projectId: string) => {
      requireApiBase(apiBase, SERVICE_NAME)
      return fetchModels(apiBase, connection, projectId)
    },
  })
  const { mutate: loadModels, reset: resetModels } = models
  // The job keeps running when the wizard is left; asking for the same setup again joins it.
  const job = useJobRun(setupJob(apiBase ?? ''), { cancelOnDispose: false })
  const { reset: resetJob } = job

  const device = chosenDevice || defaultDevice
  const modelList = models.data?.models ?? []

  /** A deployment shown is forgotten once its settings change. */
  const resetSetup = () => resetJob()

  return {
    selectedProjectId,
    project: projects.find((p) => p.id === selectedProjectId),
    models: modelList,
    selectedModelId,
    model: modelList.find((m) => m.id === selectedModelId),
    selectedDevice: device,
    isLoadingModels: models.isPending,
    modelsError: models.error?.message ?? null,
    setProject: (projectId: string) => {
      setSelectedProjectId(projectId)
      setSelectedModelId('latest')
      resetSetup()
      loadModels(projectId)
    },
    setModel: (modelId: string) => {
      setSelectedModelId(modelId)
      resetSetup()
    },
    setDevice: (next: string) => {
      setSelectedDevice(next)
      resetSetup()
    },
    /** The running setup's latest status: its stage and download. */
    progress: job.status,
    isDeploying: job.isActive,
    deployError: job.phase === 'failed' ? (job.error?.message ?? null) : null,
    deployed: job.phase === 'done' ? job.result : null,
    /** Deploys the chosen model; `null` when it failed or was abandoned. */
    deploy: async (): Promise<SetupResult | null> => {
      if (!selectedProjectId || !apiBase) return null
      const settled = await job.start({
        connection,
        phase,
        projectId: selectedProjectId,
        modelId: selectedModelId !== 'latest' ? selectedModelId : null,
        device,
      })
      if (settled.phase !== 'done' || !settled.result) return null
      // A deploy changes the worker's health; re-read it now rather than on the next poll.
      queryClient.invalidateQueries({ queryKey: healthKey(apiBase) })
      // The device it really runs on, which may differ from the one asked.
      setSelectedDevice(settled.result.device)
      return settled.result
    },
    /** Back to nothing chosen (the server's credentials changed). */
    reset: () => {
      setSelectedProjectId('')
      setSelectedModelId('latest')
      resetModels()
      resetSetup()
    },
  }
}

export type PhaseSetup = ReturnType<typeof usePhaseSetup>
