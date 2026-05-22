// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  RefreshCw,
  Rocket,
  Scissors,
  Sparkles,
  Tag,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PhaseBanner } from '../phase-banner'
import { DeploymentSummary } from '../deployment-summary'
import type { GetiModel, GetiProject, SetupResult } from '../../hooks'
import type { AppView } from '../types'

interface StepClsDeployProps {
  host: string
  project: GetiProject | undefined
  model: GetiModel | undefined
  selectedModelId: string
  selectedDevice: string
  isPending: boolean
  isError: boolean
  isSuccess: boolean
  errorMessage: string | undefined
  successData: SetupResult | undefined
  segSuccessData: SetupResult | undefined
  onDeploy: () => void
  onBack: () => void
  setCurrentView: (view: AppView) => void
}

export function StepClsDeploy({
  host,
  project,
  model,
  selectedModelId,
  selectedDevice,
  isPending,
  isError,
  isSuccess,
  errorMessage,
  successData,
  segSuccessData,
  onDeploy,
  onBack,
  setCurrentView,
}: StepClsDeployProps) {
  // Both workers deployed — show the final pipeline summary
  if (isSuccess && successData && segSuccessData) {
    return (
      <PipelineSummary
        segData={segSuccessData}
        clsData={successData}
        setCurrentView={setCurrentView}
      />
    )
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <PhaseBanner
        phase="cls"
        title="Classification Phase — Step 3 of 3"
        subtitle="Deploy the classification model to the inference worker"
        icon={Rocket}
      />

      <DeploymentSummary
        phase="cls"
        host={host}
        project={project}
        selectedModelId={selectedModelId}
        model={model}
        selectedDevice={selectedDevice}
      />

      {/* Labels row appended below the summary table */}
      {project && project.labels.length > 0 && (
        <div className="flex items-start justify-between rounded-lg border border-violet-200 bg-violet-50/30 px-4 py-2.5 dark:border-violet-800 dark:bg-violet-950/10">
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Tag className="h-3.5 w-3.5" />
            Labels
          </div>
          <div className="flex max-w-[60%] flex-wrap justify-end gap-1">
            {project.labels.map((l) => (
              <Badge
                key={l}
                className="border border-violet-200 bg-white text-[10px] text-violet-700 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-300"
              >
                {l}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {isError && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/20">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/50">
            <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-red-800 dark:text-red-300">
              Deployment Failed
            </p>
            <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">
              {errorMessage}
            </p>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" className="gap-2" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          className="flex-1 gap-2 bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-700 hover:to-purple-700"
          size="lg"
          onClick={onDeploy}
          disabled={isPending || !project}
        >
          {isPending ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              Downloading deployment...
            </>
          ) : (
            <>
              <Rocket className="h-4 w-4" />
              Deploy Classification Worker
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

// ── Pipeline summary (shown after both workers are live) ──────────────────────

function PipelineSummary({
  segData,
  clsData,
  setCurrentView,
}: {
  segData: SetupResult
  clsData: SetupResult
  setCurrentView: (view: AppView) => void
}) {
  return (
    <div className="mx-auto max-w-lg space-y-5">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-6 text-white shadow-xl">
        <div className="absolute -top-6 -right-6 h-28 w-28 rounded-full bg-white/10" />
        <div className="absolute right-12 -bottom-4 h-16 w-16 rounded-full bg-white/5" />
        <div className="relative">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-emerald-100">
                Pipeline Ready
              </p>
              <p className="text-xs text-emerald-200">
                Both workers deployed successfully
              </p>
            </div>
          </div>
          <h3 className="text-xl font-bold">Success</h3>
          <p className="mt-1 text-sm text-emerald-100">
            Segmentation + Classification Pipeline is ready
          </p>
        </div>
      </div>

      {/* Pipeline visualization */}
      <div className="bg-muted/20 space-y-3 rounded-xl border p-4">
        <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          Active Pipeline
        </p>

        <WorkerCard
          phase="seg"
          data={segData}
          icon={Scissors}
          label="Segmentation Worker"
          showConnector
        />

        <div className="flex items-center gap-3 pl-4">
          <ArrowRight className="text-muted-foreground h-3.5 w-3.5" />
          <span className="text-muted-foreground text-xs">
            Segmented regions passed to classifier
          </span>
        </div>

        <WorkerCard
          phase="cls"
          data={clsData}
          icon={BadgeCheck}
          label="Classification Worker"
          showConnector={false}
        />
      </div>

      <Button
        className="w-full gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg hover:from-emerald-600 hover:to-teal-700"
        size="lg"
        onClick={() => setCurrentView('upload')}
      >
        <Rocket className="h-4 w-4" />
        Start Classifying Images
        <ArrowRight className="ml-auto h-4 w-4" />
      </Button>
    </div>
  )
}

function WorkerCard({
  phase,
  data,
  icon: Icon,
  label,
  showConnector,
}: {
  phase: 'seg' | 'cls'
  data: SetupResult
  icon: React.ElementType
  label: string
  showConnector: boolean
}) {
  const isSeg = phase === 'seg'

  return (
    <div className="flex items-stretch gap-3">
      <div className="flex flex-col items-center gap-1">
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm ${
            isSeg
              ? 'from-blue-500 to-indigo-600'
              : 'from-violet-500 to-purple-600'
          }`}
        >
          <Icon className="h-4 w-4" />
        </div>
        {showConnector && (
          <div className="w-0.5 flex-1 bg-gradient-to-b from-blue-400 to-violet-400" />
        )}
      </div>

      <div
        className={`flex-1 rounded-lg border p-3 ${
          isSeg
            ? 'border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20'
            : 'border-violet-200 bg-violet-50/50 dark:border-violet-800 dark:bg-violet-950/20'
        }`}
      >
        <div className="mb-1 flex items-center justify-between">
          <span
            className={`text-xs font-semibold tracking-wider uppercase ${
              isSeg
                ? 'text-blue-700 dark:text-blue-300'
                : 'text-violet-700 dark:text-violet-300'
            }`}
          >
            {label}
          </span>
          <Badge className="border-0 bg-green-100 text-[10px] text-green-700 dark:bg-green-900 dark:text-green-300">
            <CheckCircle2 className="mr-1 h-2.5 w-2.5" />
            Active
          </Badge>
        </div>
        <p className="text-sm font-medium">{data.project_name}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {data.model_name}
          {data.model_version != null ? ` v${data.model_version}` : ''}
          {' · '}
          {data.device}
        </p>
        {!isSeg && data.labels && (
          <div className="mt-2 flex flex-wrap gap-1">
            {data.labels.map((lbl) => (
              <Badge
                key={lbl}
                className="border border-violet-200 bg-white text-[10px] text-violet-700 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-300"
              >
                {lbl}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
