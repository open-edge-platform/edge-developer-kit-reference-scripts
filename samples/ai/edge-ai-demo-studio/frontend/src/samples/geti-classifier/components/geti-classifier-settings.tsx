// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { BadgeCheck, Rocket } from 'lucide-react'
import { useState } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { useServiceApiBase } from '@/context/service-status-context'
import { cn } from '@/lib/utils'
import { useAvailableDevices } from '../hooks/use-devices'
import { useGetiProjects } from '../hooks/use-geti-api'
import { usePhaseSetup } from '../hooks/use-phase-setup'
import type { GetiConnection } from '../lib/api'
import type { AppView } from '../lib/classification'
import {
  nextStep,
  PHASES,
  previousStep,
  type StepKey,
  stepOf,
} from '../lib/wizard'
import { StepConnect } from './steps/step-connect'
import { StepDeploy } from './steps/step-deploy'
import { PipelineSummary } from './steps/pipeline-summary'
import { StepModel } from './steps/step-model'
import { StepProject } from './steps/step-project'
import { WizardHeader } from './wizard-header'
import { WizardProgress } from './wizard-progress'

interface GetiClassifierSettingsProps {
  /** The Geti server connected to, once connected. */
  connection: GetiConnection | null
  onConnectionChange: (connection: GetiConnection | null) => void
  /** The classification model's labels, once it is deployed. */
  onLabelsChange: (labels: string[]) => void
  setCurrentView: (view: AppView) => void
}

/** Settings wizard: connect to Geti, then choose and deploy each of the two models. */
export function GetiClassifierSettings({
  connection,
  onConnectionChange,
  onLabelsChange,
  setCurrentView,
}: GetiClassifierSettingsProps) {
  const [currentStep, setCurrentStep] = useState<StepKey>('connect')
  const [completed, setCompleted] = useState<ReadonlySet<StepKey>>(new Set())
  const markComplete = (...steps: StepKey[]) =>
    setCompleted((prev) => new Set([...prev, ...steps]))
  const goNext = () => setCurrentStep(nextStep)
  const goBack = () => setCurrentStep(previousStep)

  // The credentials being typed; `connection` is what was connected with.
  const [form, setForm] = useState<GetiConnection>(
    () => connection ?? { host: '', token: '', verifyTls: false },
  )
  const [formError, setFormError] = useState<string | null>(null)

  const apiBase = useServiceApiBase('geti-classifier')
  const { currentDevice } = useAvailableDevices(apiBase)
  const projectsQuery = useGetiProjects(apiBase)
  const projects = projectsQuery.data?.projects ?? []
  const phaseOptions = {
    apiBase,
    connection: form,
    projects,
    defaultDevice: currentDevice,
  }
  const segSetup = usePhaseSetup('seg', phaseOptions)
  const clsSetup = usePhaseSetup('cls', phaseOptions)

  /** Credentials changed: drop what the old ones loaded so it does not bleed through. */
  const changeForm = (next: GetiConnection) => {
    setForm(next)
    setFormError(null)
    projectsQuery.reset()
    segSetup.reset()
    clsSetup.reset()
  }

  const connect = () => {
    if (!form.host.trim() || !form.token.trim()) {
      setFormError('Both Geti server URL and API token are required')
      return
    }
    if (!form.host.startsWith('http://') && !form.host.startsWith('https://')) {
      setFormError('Server URL must start with http:// or https://')
      return
    }
    setFormError(null)
    segSetup.reset()
    clsSetup.reset()
    projectsQuery.mutate(form, {
      onSuccess: () => {
        onConnectionChange({
          host: form.host.trim(),
          token: form.token.trim(),
          verifyTls: form.verifyTls,
        })
        markComplete('connect')
        goNext()
      },
      onError: () => onConnectionChange(null),
    })
  }

  const step = stepOf(currentStep)
  const phase = PHASES[step.phase]
  const segDeployed = segSetup.deployed
  const clsDeployed = clsSetup.deployed

  return (
    <Card className="w-full overflow-hidden border-0 shadow-lg">
      <div
        aria-hidden
        className={cn('h-1 w-full transition-all duration-700', phase.solid)}
      />

      <CardHeader className="bg-muted/20 border-b pt-4 pb-3">
        <WizardHeader
          step={step}
          connected={connection !== null}
          onBack={() => setCurrentView('upload')}
        />
        <WizardProgress
          current={currentStep}
          completed={completed}
          onStepClick={setCurrentStep}
        />
      </CardHeader>

      <CardContent className="p-6">
        {currentStep === 'connect' && (
          <StepConnect
            value={form}
            onChange={changeForm}
            error={formError ?? projectsQuery.error?.message ?? null}
            isConnecting={projectsQuery.isPending}
            onConnect={connect}
          />
        )}

        {currentStep === 'seg-project' && (
          <StepProject
            phase="seg"
            projects={projects}
            setup={segSetup}
            onBack={goBack}
            onContinue={() => {
              markComplete('seg-project')
              goNext()
            }}
          />
        )}

        {currentStep === 'seg-model' && (
          <StepModel
            phase="seg"
            setup={segSetup}
            onBack={goBack}
            onContinue={() => {
              markComplete('seg-model')
              goNext()
            }}
          />
        )}

        {currentStep === 'seg-deploy' && (
          <StepDeploy
            phase="seg"
            host={form.host}
            setup={segSetup}
            onBack={goBack}
            onDeploy={async () => {
              if (await segSetup.deploy()) {
                markComplete('seg-model', 'seg-deploy')
                goNext()
              }
            }}
            next={{
              label: 'Continue to Classification Setup',
              icon: BadgeCheck,
              onClick: () => {
                markComplete('seg-deploy')
                goNext()
              },
            }}
          />
        )}

        {currentStep === 'cls-project' && (
          <StepProject
            phase="cls"
            projects={projects}
            setup={clsSetup}
            onBack={goBack}
            onContinue={() => {
              markComplete('cls-project')
              goNext()
            }}
          />
        )}

        {currentStep === 'cls-model' && (
          <StepModel
            phase="cls"
            setup={clsSetup}
            onBack={goBack}
            onContinue={() => {
              markComplete('cls-model')
              goNext()
            }}
          />
        )}

        {currentStep === 'cls-deploy' &&
          (segDeployed && clsDeployed ? (
            <PipelineSummary
              segData={segDeployed}
              clsData={clsDeployed}
              onStart={() => setCurrentView('upload')}
            />
          ) : (
            <StepDeploy
              phase="cls"
              host={form.host}
              setup={clsSetup}
              onBack={goBack}
              onDeploy={async () => {
                const deployed = await clsSetup.deploy()
                if (deployed) {
                  onLabelsChange(deployed.labels)
                  markComplete('cls-model', 'cls-deploy')
                }
              }}
              next={{
                label: 'Start Classifying Images',
                icon: Rocket,
                onClick: () => setCurrentView('upload'),
              }}
            />
          ))}
      </CardContent>
    </Card>
  )
}
