// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader } from 'lucide-react'
import { useState } from 'react'
import { useServiceApiBase } from '@/context/service-status-context'
import { StepProgress } from '../common/components/step-progress'
import type { Sample } from '../types'
import { AppStep } from './components/app-step'
import { CalibrationStep } from './components/calibration-step'
import { PrerequisitesStep } from './components/prerequisites-step'
import { RobotSetupStep } from './components/robot-setup-step'
import { useRoboticsChat } from './hooks/use-robotics-chat'
import { useRoboticsMcp } from './hooks/use-robotics-mcp'
import { useRoboticsMic } from './hooks/use-robotics-mic'
import { useRoboticsSetup } from './hooks/use-robotics-setup'
import { DEFAULT_ROBOT_LANGUAGE, type RobotLanguage } from './lib/languages'

type WizardStep = 'prerequisites' | 'robot-setup' | 'calibration' | 'app'

const STEPS: { key: WizardStep; label: string }[] = [
  { key: 'prerequisites', label: 'Prerequisites' },
  { key: 'robot-setup', label: 'Robot Setup' },
  { key: 'calibration', label: 'Calibration' },
  { key: 'app', label: 'Application' },
]

export function RoboticsAiDemo({ sample: _sample }: { sample: Sample }) {
  // `undefined` while services load or the instance hasn't started; there is no fallback address.
  const defaultApiBase = useServiceApiBase('robotics-ai')
  const workerBaseUrl =
    process.env.NEXT_PUBLIC_ROBOTICS_WORKER_URL ?? defaultApiBase

  const [wizardStep, setWizardStep] = useState<WizardStep>('robot-setup')
  // Opens on Robot Setup unless a prerequisite check failed. Decided once, during render (never
  // from an effect), when the checks first load, so a later refetch cannot pull the user back.
  const [prerequisitesSeen, setPrerequisitesSeen] = useState(false)

  const setup = useRoboticsSetup(workerBaseUrl)
  if (!prerequisitesSeen && setup.prerequisites) {
    setPrerequisitesSeen(true)
    if (!setup.prerequisites.dialout || !setup.prerequisites.librealsense) {
      setWizardStep('prerequisites')
    }
  }
  // Kept here, not in the app step, so the MCP connection is made as the
  // demo opens and the conversation survives a trip back to calibration.
  const mcp = useRoboticsMcp(workerBaseUrl)
  const chat = useRoboticsChat()
  const [language, setLanguage] = useState<RobotLanguage>(
    DEFAULT_ROBOT_LANGUAGE,
  )
  const mic = useRoboticsMic({ language, onTranscribed: chat.setInput })

  if (
    !workerBaseUrl ||
    setup.isRobotTypeLoading ||
    setup.isPrerequisitesLoading
  ) {
    return (
      <div className="glass-card relative overflow-hidden rounded-xl">
        <div className="from-primary/[0.04] via-secondary/[0.02] pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent" />
        <div
          role="status"
          className="flex flex-col items-center justify-center px-6 py-20 text-center sm:py-28"
        >
          <Loader
            className="text-muted-foreground h-8 w-8 animate-spin"
            aria-hidden
          />
          <p className="text-muted-foreground mt-4 text-sm">
            Checking system configuration…
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="glass-card relative overflow-hidden rounded-xl px-6 py-4">
        <StepProgress
          steps={STEPS}
          current={wizardStep}
          label="Robot setup steps"
        />
      </div>

      {wizardStep === 'prerequisites' && (
        <PrerequisitesStep
          prerequisites={setup.prerequisites}
          onContinue={() => setWizardStep('robot-setup')}
        />
      )}
      {wizardStep === 'robot-setup' && (
        <RobotSetupStep
          setup={setup}
          onContinue={() => setWizardStep('calibration')}
        />
      )}
      {wizardStep === 'calibration' && (
        <CalibrationStep
          workerBaseUrl={workerBaseUrl}
          robotTypeReady={setup.robotTypeReady}
          onProceed={() => setWizardStep('app')}
        />
      )}
      {wizardStep === 'app' && (
        <AppStep
          workerBaseUrl={workerBaseUrl}
          mcp={mcp}
          chat={chat}
          mic={mic}
          language={language}
          onLanguageChange={setLanguage}
          onBackToCalibration={() => setWizardStep('calibration')}
        />
      )}
    </div>
  )
}
