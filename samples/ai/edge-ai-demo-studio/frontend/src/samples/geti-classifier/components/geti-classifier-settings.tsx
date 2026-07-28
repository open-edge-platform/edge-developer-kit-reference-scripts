// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState, useCallback } from 'react'
import { Activity, ArrowLeft, BadgeCheck, Plug, Scissors } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  useProjects,
  useModels,
  useSetup,
  useAutoSync,
  useAvailableDevices,
} from '../hooks'
import type { GetiProject, GetiModel } from '../hooks'
import { PHASE_CONFIG, STEP_TITLES, STEP_DESCRIPTIONS } from '../constants'
import { StepIndicator } from '../components/step-indicator'
import { StepConnect } from '../components/steps/step-connect'
import { StepSegProject } from '../components/steps/step-seg-project'
import { StepSegModel } from '../components/steps/step-seg-model'
import { StepSegDeploy } from '../components/steps/step-seg-deploy'
import { StepClsProject } from '../components/steps/step-cls-project'
import { StepClsModel } from '../components/steps/step-cls-model'
import { StepClsDeploy } from '../components/steps/step-cls-deploy'
import type { GetiConfig, AppView } from './types'

const TOTAL_STEPS = 7

interface GetiClassifierSettingsProps {
  getiConfig: GetiConfig
  isConnected: boolean
  setGetiConfig: (config: GetiConfig) => void
  setIsConnected: (connected: boolean) => void
  setWorkerLabels: (labels: string[]) => void
  setCurrentView: (view: AppView) => void
}

export function GetiClassifierSettings({
  getiConfig,
  isConnected,
  setGetiConfig,
  setIsConnected,
  setWorkerLabels,
  setCurrentView,
}: GetiClassifierSettingsProps) {
  // ── Wizard navigation ───────────────────────────────────────────────────────
  const [currentStep, setCurrentStep] = useState(1)
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set())

  const markComplete = (step: number) =>
    setCompletedSteps((prev) => new Set([...prev, step]))
  const goTo = (step: number) => setCurrentStep(step)
  const goNext = () => setCurrentStep((s) => Math.min(s + 1, TOTAL_STEPS))
  const goBack = () => setCurrentStep((s) => Math.max(s - 1, 1))

  // ── Credentials ─────────────────────────────────────────────────────────────
  const [localHost, setLocalHost] = useState(getiConfig.host)
  const [localToken, setLocalToken] = useState(getiConfig.token)
  const [hostError, setHostError] = useState<string | null>(null)

  // ── Segmentation state ──────────────────────────────────────────────────────
  const [segProjects, setSegProjects] = useState<GetiProject[]>([])
  const [segSelectedProjectId, setSegSelectedProjectId] = useState('')
  const [segModels, setSegModels] = useState<GetiModel[]>([])
  const [segSelectedModelId, setSegSelectedModelId] = useState('latest')
  const [segSelectedDevice, setSegSelectedDevice] = useState('')

  // ── Classification state ────────────────────────────────────────────────────
  const [clsProjects, setClsProjects] = useState<GetiProject[]>([])
  const [clsSelectedProjectId, setClsSelectedProjectId] = useState('')
  const [clsModels, setClsModels] = useState<GetiModel[]>([])
  const [clsSelectedModelId, setClsSelectedModelId] = useState('latest')
  const [clsSelectedDevice, setClsSelectedDevice] = useState('')

  // ── Auto-sync ───────────────────────────────────────────────────────────────
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false)

  // ── Seed device default from react-query (runs once on mount) ───────────────
  const { currentDevice } = useAvailableDevices()
  const [deviceSeeded, setDeviceSeeded] = useState(false)
  if (currentDevice && !deviceSeeded) {
    setSegSelectedDevice(currentDevice)
    setClsSelectedDevice(currentDevice)
    setDeviceSeeded(true)
  }

  // ── API mutations ────────────────────────────────────────────────────────────

  const fetchProjects = useProjects({
    onSuccess: (data) => {
      setSegProjects(data.projects)
      setClsProjects(data.projects)
      setIsConnected(true)
      setGetiConfig({ host: localHost.trim(), token: localToken.trim() })
      markComplete(1)
      goNext()
    },
    onError: () => setIsConnected(false),
  })

  const fetchSegModels = useModels({
    onSuccess: (data) => setSegModels(data.models),
  })

  const fetchClsModels = useModels({
    onSuccess: (data) => setClsModels(data.models),
  })

  const setupSeg = useSetup({
    onSuccess: () => {
      markComplete(3)
      markComplete(4)
      goNext()
    },
  })

  const setupCls = useSetup({
    onSuccess: (data) => {
      setWorkerLabels(data.labels)
      setClsSelectedDevice(data.device)
      markComplete(6)
      markComplete(7)
    },
  })

  const autoSync = useAutoSync({
    onSuccess: (data) => setAutoSyncEnabled(data.enabled),
  })

  // ── Handlers ─────────────────────────────────────────────────────────────────

  /**
   * Wipe all downstream state whenever credentials change so stale
   * project/model data from a previous server can't bleed through.
   */
  const resetDownstream = useCallback(() => {
    setSegProjects([])
    setClsProjects([])
    setSegSelectedProjectId('')
    setClsSelectedProjectId('')
    setSegModels([])
    setClsModels([])
    setSegSelectedModelId('latest')
    setClsSelectedModelId('latest')
    setupSeg.reset()
    setupCls.reset()
  }, [setupSeg, setupCls])

  const handleConnect = useCallback(() => {
    setHostError(null)
    if (!localHost.trim() || !localToken.trim()) {
      setHostError('Both Geti server URL and API token are required')
      return
    }
    if (!localHost.startsWith('http://') && !localHost.startsWith('https://')) {
      setHostError('Server URL must start with http:// or https://')
      return
    }
    resetDownstream()
    fetchProjects.mutate({
      host: localHost.trim(),
      token: localToken.trim(),
      verifySsl: false,
    })
  }, [localHost, localToken, fetchProjects, resetDownstream])

  const handleSegProjectChange = useCallback(
    (projectId: string) => {
      setSegSelectedProjectId(projectId)
      setSegModels([])
      setSegSelectedModelId('latest')
      setupSeg.reset()
      fetchSegModels.mutate({
        host: localHost.trim(),
        token: localToken.trim(),
        projectId,
        verifySsl: false,
      })
    },
    [localHost, localToken, fetchSegModels, setupSeg],
  )

  const handleClsProjectChange = useCallback(
    (projectId: string) => {
      setClsSelectedProjectId(projectId)
      setClsModels([])
      setClsSelectedModelId('latest')
      setupCls.reset()
      fetchClsModels.mutate({
        host: localHost.trim(),
        token: localToken.trim(),
        projectId,
        verifySsl: false,
      })
    },
    [localHost, localToken, fetchClsModels, setupCls],
  )

  const handleSetupSeg = useCallback(() => {
    if (!segSelectedProjectId) return
    setupSeg.mutate({
      host: localHost.trim(),
      token: localToken.trim(),
      projectId: segSelectedProjectId,
      modelId: segSelectedModelId !== 'latest' ? segSelectedModelId : null,
      verifySsl: false,
      device: segSelectedDevice,
      setupType: 'seg',
    })
  }, [
    segSelectedProjectId,
    segSelectedModelId,
    segSelectedDevice,
    localHost,
    localToken,
    setupSeg,
  ])

  const handleSetupCls = useCallback(() => {
    if (!clsSelectedProjectId) return
    setupCls.mutate({
      host: localHost.trim(),
      token: localToken.trim(),
      projectId: clsSelectedProjectId,
      modelId: clsSelectedModelId !== 'latest' ? clsSelectedModelId : null,
      verifySsl: false,
      device: clsSelectedDevice,
      setupType: 'cls',
    })
  }, [
    clsSelectedProjectId,
    clsSelectedModelId,
    clsSelectedDevice,
    localHost,
    localToken,
    setupCls,
  ])

  const handleToggleAutoSync = useCallback(() => {
    autoSync.mutate(!autoSyncEnabled)
  }, [autoSync, autoSyncEnabled])

  // ── Derived values ────────────────────────────────────────────────────────────

  const segProject = segProjects.find((p) => p.id === segSelectedProjectId)
  const segModel = segModels.find((m) => m.id === segSelectedModelId)
  const clsProject = clsProjects.find((p) => p.id === clsSelectedProjectId)
  const clsModel = clsModels.find((m) => m.id === clsSelectedModelId)

  const currentPhase =
    currentStep === 1 ? 'connect' : currentStep <= 4 ? 'seg' : ('cls' as const)

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <Card className="w-full overflow-hidden border-0 shadow-lg">
      {/* Gradient accent bar */}
      <div
        className={cn(
          'h-1 w-full bg-gradient-to-r transition-all duration-700',
          currentPhase === 'connect'
            ? 'from-slate-400 via-slate-500 to-slate-600'
            : currentPhase === 'seg'
              ? 'from-blue-400 via-blue-500 to-indigo-600'
              : 'from-violet-400 via-violet-500 to-purple-600',
        )}
      />

      {/* ── Card header ─────────────────────────────────────────────────────── */}
      <CardHeader className="bg-muted/20 border-b pt-4 pb-3">
        <div className="flex items-start justify-between gap-4">
          {/* Phase icon + title */}
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md transition-all duration-500',
                currentPhase === 'connect'
                  ? PHASE_CONFIG.connect.gradient
                  : currentPhase === 'seg'
                    ? PHASE_CONFIG.seg.gradient
                    : PHASE_CONFIG.cls.gradient,
              )}
            >
              {currentStep === 1 ? (
                <Plug className="h-5 w-5" />
              ) : currentStep <= 4 ? (
                <Scissors className="h-5 w-5" />
              ) : (
                <BadgeCheck className="h-5 w-5" />
              )}
            </div>

            <div>
              <CardTitle className="text-base">
                {STEP_TITLES[currentStep]}
              </CardTitle>
              <CardDescription className="mt-0.5 text-xs">
                {STEP_DESCRIPTIONS[currentStep]}
              </CardDescription>
            </div>
          </div>

          {/* Right-side controls */}
          <div className="flex flex-shrink-0 items-center gap-2">
            {/* Connection status pill */}
            <div
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all',
                isConnected
                  ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400'
                  : 'border-muted bg-muted/50 text-muted-foreground',
              )}
            >
              <div
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  isConnected
                    ? 'animate-pulse bg-green-500'
                    : 'bg-muted-foreground/50',
                )}
              />
              {isConnected ? 'Connected' : 'Not Connected'}
            </div>

            {/* Auto-sync toggle */}
            <div
              className={cn(
                'flex items-center gap-2 rounded-full border px-2.5 py-1 transition-all',
                autoSyncEnabled
                  ? 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30'
                  : 'border-muted bg-muted/30',
              )}
            >
              <Activity
                className={cn(
                  'h-3 w-3',
                  autoSyncEnabled ? 'text-blue-500' : 'text-muted-foreground',
                )}
              />
              <span className="text-xs font-medium">Auto-sync</span>
              <Switch
                checked={autoSyncEnabled}
                onCheckedChange={handleToggleAutoSync}
                disabled={autoSync.isPending}
                className="scale-75"
              />
            </div>

            {/* Back to main */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => setCurrentView('upload')}
              title="Back to main"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <StepIndicator
          currentStep={currentStep}
          completedSteps={completedSteps}
          onStepClick={goTo}
        />
      </CardHeader>

      {/* ── Step content ────────────────────────────────────────────────────── */}
      <CardContent className="p-0">
        <div className="p-6">
          {currentStep === 1 && (
            <StepConnect
              localHost={localHost}
              localToken={localToken}
              hostError={hostError}
              isPending={fetchProjects.isPending}
              isError={fetchProjects.isError}
              errorMessage={fetchProjects.error?.message}
              onHostChange={(val) => {
                setLocalHost(val)
                resetDownstream()
              }}
              onTokenChange={(val) => {
                setLocalToken(val)
                resetDownstream()
              }}
              onConnect={handleConnect}
            />
          )}

          {currentStep === 2 && (
            <StepSegProject
              projects={segProjects}
              selectedProjectId={segSelectedProjectId}
              isLoadingModels={fetchSegModels.isPending}
              isModelsError={fetchSegModels.isError}
              modelsErrorMessage={fetchSegModels.error?.message}
              onProjectChange={handleSegProjectChange}
              onBack={goBack}
              onContinue={() => {
                markComplete(2)
                goNext()
              }}
            />
          )}

          {currentStep === 3 && (
            <StepSegModel
              project={segProject}
              models={segModels}
              selectedModelId={segSelectedModelId}
              selectedDevice={segSelectedDevice}
              onModelChange={setSegSelectedModelId}
              onDeviceChange={setSegSelectedDevice}
              onSetupReset={setupSeg.reset}
              onBack={goBack}
              onContinue={() => {
                markComplete(3)
                goNext()
              }}
            />
          )}

          {currentStep === 4 && (
            <StepSegDeploy
              host={localHost}
              project={segProject}
              model={segModel}
              selectedModelId={segSelectedModelId}
              selectedDevice={segSelectedDevice}
              isPending={setupSeg.isPending}
              isError={setupSeg.isError}
              isSuccess={setupSeg.isSuccess}
              errorMessage={setupSeg.error?.message}
              successData={setupSeg.data}
              onDeploy={handleSetupSeg}
              onBack={goBack}
              onContinue={() => {
                markComplete(4)
                goNext()
              }}
            />
          )}

          {currentStep === 5 && (
            <StepClsProject
              projects={clsProjects}
              selectedProjectId={clsSelectedProjectId}
              isLoadingModels={fetchClsModels.isPending}
              isModelsError={fetchClsModels.isError}
              modelsErrorMessage={fetchClsModels.error?.message}
              onProjectChange={handleClsProjectChange}
              onBack={goBack}
              onContinue={() => {
                markComplete(5)
                goNext()
              }}
            />
          )}

          {currentStep === 6 && (
            <StepClsModel
              project={clsProject}
              models={clsModels}
              selectedModelId={clsSelectedModelId}
              selectedDevice={clsSelectedDevice}
              onModelChange={setClsSelectedModelId}
              onDeviceChange={setClsSelectedDevice}
              onSetupReset={setupCls.reset}
              onBack={goBack}
              onContinue={() => {
                markComplete(6)
                goNext()
              }}
            />
          )}

          {currentStep === 7 && (
            <StepClsDeploy
              host={localHost}
              project={clsProject}
              model={clsModel}
              selectedModelId={clsSelectedModelId}
              selectedDevice={clsSelectedDevice}
              isPending={setupCls.isPending}
              isError={setupCls.isError}
              isSuccess={setupCls.isSuccess}
              errorMessage={setupCls.error?.message}
              successData={setupCls.data}
              segSuccessData={setupSeg.data}
              onDeploy={handleSetupCls}
              onBack={goBack}
              setCurrentView={setCurrentView}
            />
          )}
        </div>
      </CardContent>
    </Card>
  )
}
