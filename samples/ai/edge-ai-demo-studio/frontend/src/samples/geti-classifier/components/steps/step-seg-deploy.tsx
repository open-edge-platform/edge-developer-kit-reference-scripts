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
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PhaseBanner } from '../phase-banner'
import { DeploymentSummary } from '../deployment-summary'
import type { GetiModel, GetiProject, SetupResult } from '../../hooks'

interface StepSegDeployProps {
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
  onDeploy: () => void
  onBack: () => void
  onContinue: () => void
}

export function StepSegDeploy({
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
  onDeploy,
  onBack,
  onContinue,
}: StepSegDeployProps) {
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <PhaseBanner
        phase="seg"
        title="Segmentation Phase — Step 3 of 3"
        subtitle="Deploy the segmentation model to the inference worker"
        icon={Rocket}
      />

      <DeploymentSummary
        phase="seg"
        host={host}
        project={project}
        selectedModelId={selectedModelId}
        model={model}
        selectedDevice={selectedDevice}
      />

      {isError && <DeployError message={errorMessage} />}

      {isSuccess && successData ? (
        <DeploySuccess data={successData} onContinue={onContinue} />
      ) : (
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <Button
            className="flex-1 gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700"
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
                Deploy Segmentation Worker
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Private sub-components ────────────────────────────────────────────────────

function DeployError({ message }: { message: string | undefined }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/20">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/50">
        <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
      </div>
      <div>
        <p className="text-sm font-medium text-red-800 dark:text-red-300">
          Deployment Failed
        </p>
        <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">
          {message}
        </p>
      </div>
    </div>
  )
}

function DeploySuccess({
  data,
  onContinue,
}: {
  data: SetupResult
  onContinue: () => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950/20">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/50">
          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
        </div>
        <div>
          <p className="font-medium text-green-800 dark:text-green-300">
            Segmentation Worker Deployed!
          </p>
          <p className="mt-0.5 text-xs text-green-700 dark:text-green-400">
            {data.model_name}
            {data.model_version != null ? ` v${data.model_version}` : ''}
            {' · '}
            {data.device}
            {' · '}
            {data.project_name}
          </p>
        </div>
      </div>

      <Button
        className="w-full gap-2 bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-700 hover:to-purple-700"
        size="lg"
        onClick={onContinue}
      >
        <BadgeCheck className="h-4 w-4" />
        Continue to Classification Setup
        <ArrowRight className="ml-auto h-4 w-4" />
      </Button>
    </div>
  )
}
