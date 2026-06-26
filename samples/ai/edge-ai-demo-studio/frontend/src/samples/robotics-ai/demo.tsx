// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { type ChangeEvent, useState } from 'react'
import Image from 'next/image'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Brain,
  CheckCircle2,
  ChevronRight,
  ImageIcon,
  Loader2,
  Mic,
  MicOff,
  RefreshCcw,
  RotateCcw,
  Send,
  Settings2,
  Square,
  Terminal,
  Usb,
  Video,
  XCircle,
} from 'lucide-react'
import { Streamdown } from 'streamdown'
import { cn } from '@/lib/utils'
import { type UIMessage, isToolUIPart, getToolName } from 'ai'
import type { Sample } from '../types'
import {
  type ArucoDetectResult,
  type JointReading,
  DEFAULT_CHAT_SUGGESTIONS,
  useRoboticsAiDemo,
} from '@/services/robotics-ai/hooks'

// ── Types ──────────────────────────────────────────────────────────

type WizardStep = 'prerequisites' | 'robot-setup' | 'calibration' | 'app'

// ── Component ─────────────────────────────────────────────────────

export function RoboticsAiDemo({ sample: _sample }: { sample: Sample }) {
  const [wizardStep, setWizardStep] = useState<WizardStep>('robot-setup')
  const [layoutDialogOpen, setLayoutDialogOpen] = useState(false)
  const [motorCalibrationDialogOpen, setMotorCalibrationDialogOpen] =
    useState(false)
  const [motorCalibrationChoice, setMotorCalibrationChoice] = useState<
    'use_existing' | 'run' | null
  >(null)

  const demo = useRoboticsAiDemo()

  const {
    workerBaseUrl,
    isConnected,
    setIsConnected,
    mcpStatus,
    mcpStatusMessage,
    mcpStatusClass,
    mcpStatusLabel,
    messages,
    input,
    setInput,
    isLoading,
    availableTools,
    selectedToolId,
    setSelectedToolId,
    selectedTool,
    isListening,
    isTranscribing,
    micError,
    micLanguage,
    micLanguageOptions,
    selectedMicLanguageLabel,
    isReloadingCamera,
    cameraStatusMessage,
    hasMicrophone: _hasMicrophone,
    micButtonDisabled,
    imgRef,
    chatMessagesRef,
    handleMicLanguageChange,
    handleReset,
    sendMessage,
    handleSuggestionClick,
    handleReloadCamera,
    connectMcpServer,
    handleMicStartListening,
    handleMicStopListening,
    robotTypeReady: _robotTypeReady,
    isRobotTypeLoading,
    isPrerequisitesLoading,
    prerequisites,
    calibrationStatus,
    availableRobotTypes,
    availableRobotPorts,
    selectedSetupRobotType,
    setSelectedSetupRobotType,
    selectedSetupRobotPort,
    setSelectedSetupRobotPort,
    isSettingRobotType,
    robotTypeSetError,
    handleConfirmRobotType,
    calibrationState,
    isCalibrationStarting,
    isCalibrationConfirming,
    calibrationError,
    calibrationMessage,
    handleCalibrationStart,
    handleCalibrationConfirm,
    motorCalibrationState,
    motorCalibrationJointReadings,
    isMotorCalibrationStarting,
    isMotorCalibrationNexting,
    motorCalibrationError,
    motorCalibrationMessage,
    handleMotorCalibrationStart,
    handleMotorCalibrationNext,
    gripperOpen,
    gripperClose,
    setGripperOpen,
    setGripperClose,
    isSavingGripperConfig,
    gripperConfigError,
    gripperConfigMessage,
    handleSaveGripperConfig,
    arucoDetectResult,
    isArucoPolling,
    setIsArucoPolling,
    isArucoCalibrating,
    arucoError,
    arucoMessage,
    handleArucoCalibrate,
    useMcp,
    setUseMcp,
  } = demo

  // ── Auto-advance wizard ─────────────────────────────────────────

  // Active step is directly controlled by user navigation (no auto-advancement).
  // The user always starts at robot-setup to verify the port.
  const activeStep = wizardStep

  // ── Loading state ────────────────────────────────────────────────

  if (isRobotTypeLoading || isPrerequisitesLoading) {
    return (
      <div className="glass-card relative overflow-hidden rounded-xl">
        <div className="from-primary/[0.04] via-secondary/[0.02] pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent" />
        <div className="flex flex-col items-center justify-center px-6 py-20 text-center sm:py-28">
          <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
          <p className="text-muted-foreground mt-4 text-sm">
            Checking system configuration…
          </p>
        </div>
      </div>
    )
  }

  // ── Wizard Step Indicator ────────────────────────────────────────

  const steps: { key: WizardStep; label: string }[] = [
    { key: 'prerequisites', label: 'Prerequisites' },
    { key: 'robot-setup', label: 'Robot Setup' },
    { key: 'calibration', label: 'Calibration' },
    { key: 'app', label: 'Application' },
  ]

  const stepIndex = steps.findIndex((s) => s.key === activeStep)

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <nav className="glass-card relative overflow-hidden rounded-xl px-6 py-4">
        <ol className="flex items-center gap-2">
          {steps.map((step, i) => {
            const isCurrent = i === stepIndex
            const isComplete = i < stepIndex
            return (
              <li key={step.key} className="flex items-center gap-2">
                {i > 0 && (
                  <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" />
                )}
                <span
                  className={cn(
                    'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    isCurrent &&
                      'bg-primary/10 text-primary ring-primary/20 ring-1',
                    isComplete && 'text-green-700 dark:text-green-400',
                    !isCurrent && !isComplete && 'text-muted-foreground',
                  )}
                >
                  {isComplete && (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                  )}
                  {step.label}
                </span>
              </li>
            )
          })}
        </ol>
      </nav>

      {/* Step content */}
      {activeStep === 'prerequisites' && (
        <PrerequisitesStep
          prerequisites={prerequisites}
          onContinue={() => setWizardStep('robot-setup')}
        />
      )}
      {activeStep === 'robot-setup' && (
        <RobotSetupStep
          availableRobotTypes={availableRobotTypes}
          availableRobotPorts={availableRobotPorts}
          selectedSetupRobotType={selectedSetupRobotType}
          setSelectedSetupRobotType={setSelectedSetupRobotType}
          selectedSetupRobotPort={selectedSetupRobotPort}
          setSelectedSetupRobotPort={setSelectedSetupRobotPort}
          isSettingRobotType={isSettingRobotType}
          robotTypeSetError={robotTypeSetError}
          handleConfirmRobotType={handleConfirmRobotType}
          onContinue={() => setWizardStep('calibration')}
        />
      )}
      {activeStep === 'calibration' && (
        <CalibrationStep
          calibrationStatus={calibrationStatus}
          motorCalibrationState={motorCalibrationState}
          motorCalibrationJointReadings={motorCalibrationJointReadings}
          isMotorCalibrationStarting={isMotorCalibrationStarting}
          isMotorCalibrationNexting={isMotorCalibrationNexting}
          motorCalibrationError={motorCalibrationError}
          motorCalibrationMessage={motorCalibrationMessage}
          handleMotorCalibrationStart={handleMotorCalibrationStart}
          handleMotorCalibrationNext={handleMotorCalibrationNext}
          motorCalibrationChoice={motorCalibrationChoice}
          setMotorCalibrationChoice={setMotorCalibrationChoice}
          motorCalibrationDialogOpen={motorCalibrationDialogOpen}
          setMotorCalibrationDialogOpen={setMotorCalibrationDialogOpen}
          gripperOpen={gripperOpen}
          gripperClose={gripperClose}
          setGripperOpen={setGripperOpen}
          setGripperClose={setGripperClose}
          isSavingGripperConfig={isSavingGripperConfig}
          gripperConfigError={gripperConfigError}
          gripperConfigMessage={gripperConfigMessage}
          handleSaveGripperConfig={handleSaveGripperConfig}
          calibrationState={calibrationState}
          isCalibrationStarting={isCalibrationStarting}
          isCalibrationConfirming={isCalibrationConfirming}
          calibrationError={calibrationError}
          calibrationMessage={calibrationMessage}
          handleCalibrationStart={handleCalibrationStart}
          handleCalibrationConfirm={handleCalibrationConfirm}
          arucoDetectResult={arucoDetectResult}
          isArucoPolling={isArucoPolling}
          setIsArucoPolling={setIsArucoPolling}
          isArucoCalibrating={isArucoCalibrating}
          arucoError={arucoError}
          arucoMessage={arucoMessage}
          handleArucoCalibrate={handleArucoCalibrate}
          layoutDialogOpen={layoutDialogOpen}
          setLayoutDialogOpen={setLayoutDialogOpen}
          workerBaseUrl={workerBaseUrl}
          isReloadingCamera={isReloadingCamera}
          cameraStatusMessage={cameraStatusMessage}
          handleReloadCamera={handleReloadCamera}
          onProceed={() => setWizardStep('app')}
        />
      )}
      {activeStep === 'app' && (
        <AppStep
          workerBaseUrl={workerBaseUrl}
          isConnected={isConnected}
          setIsConnected={setIsConnected}
          mcpStatus={mcpStatus}
          mcpStatusMessage={mcpStatusMessage}
          mcpStatusClass={mcpStatusClass}
          mcpStatusLabel={mcpStatusLabel}
          messages={messages}
          input={input}
          setInput={setInput}
          isLoading={isLoading}
          availableTools={availableTools}
          selectedToolId={selectedToolId}
          setSelectedToolId={setSelectedToolId}
          selectedTool={selectedTool}
          isListening={isListening}
          isTranscribing={isTranscribing}
          micError={micError}
          micLanguage={micLanguage}
          micLanguageOptions={micLanguageOptions}
          selectedMicLanguageLabel={selectedMicLanguageLabel}
          isReloadingCamera={isReloadingCamera}
          cameraStatusMessage={cameraStatusMessage}
          micButtonDisabled={micButtonDisabled}
          imgRef={imgRef}
          chatMessagesRef={chatMessagesRef}
          handleMicLanguageChange={handleMicLanguageChange}
          handleReset={handleReset}
          sendMessage={sendMessage}
          handleSuggestionClick={handleSuggestionClick}
          handleReloadCamera={handleReloadCamera}
          connectMcpServer={connectMcpServer}
          handleMicStartListening={handleMicStartListening}
          handleMicStopListening={handleMicStopListening}
          useMcp={useMcp}
          setUseMcp={setUseMcp}
          onBackToCalibration={() => setWizardStep('calibration')}
        />
      )}
    </div>
  )
}

// ── Step 1: Prerequisites ──────────────────────────────────────────

function PrerequisitesStep({
  prerequisites,
  onContinue,
}: {
  prerequisites: { dialout: boolean; librealsense: boolean } | undefined
  onContinue: () => void
}) {
  const allPassed =
    prerequisites?.dialout === true && prerequisites?.librealsense === true

  return (
    <div className="glass-card relative overflow-hidden rounded-xl">
      <div className="from-primary/[0.04] via-secondary/[0.02] pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent" />
      <div className="px-6 py-10 sm:px-10">
        <div className="mb-6 flex items-center gap-3">
          <div className="bg-primary/10 ring-primary/20 flex h-12 w-12 items-center justify-center rounded-xl ring-1">
            <Terminal className="text-primary h-6 w-6" />
          </div>
          <div>
            <h3 className="text-foreground text-lg font-semibold">
              System Prerequisites
            </h3>
            <p className="text-muted-foreground text-sm">
              Verify these requirements before connecting your robot.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Dialout group */}
          <div
            className={cn(
              'rounded-lg px-4 py-3 ring-1',
              prerequisites?.dialout
                ? 'bg-green-50 ring-green-200 dark:bg-green-900/20 dark:ring-green-700/40'
                : 'bg-red-50 ring-red-200 dark:bg-red-900/20 dark:ring-red-700/40',
            )}
          >
            <div className="flex items-center gap-2">
              {prerequisites?.dialout ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              )}
              <p className="text-sm font-medium">
                User in <code className="font-mono font-bold">dialout</code>{' '}
                group
              </p>
            </div>
            {!prerequisites?.dialout && (
              <div className="mt-2 pl-6">
                <p className="text-xs leading-relaxed text-red-700 dark:text-red-400">
                  Required to access the robot&apos;s serial port without sudo.
                  Run the command below and then <strong>reboot</strong>.
                </p>
                <pre className="mt-2 rounded-md bg-red-100 px-3 py-2 font-mono text-xs text-red-900 select-all dark:bg-red-900/40 dark:text-red-200">
                  sudo usermod -aG dialout $USER
                </pre>
              </div>
            )}
          </div>

          {/* librealsense */}
          <div
            className={cn(
              'rounded-lg px-4 py-3 ring-1',
              prerequisites?.librealsense
                ? 'bg-green-50 ring-green-200 dark:bg-green-900/20 dark:ring-green-700/40'
                : 'bg-red-50 ring-red-200 dark:bg-red-900/20 dark:ring-red-700/40',
            )}
          >
            <div className="flex items-center gap-2">
              {prerequisites?.librealsense ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              )}
              <p className="text-sm font-medium">
                Intel RealSense SDK (librealsense2)
              </p>
            </div>
            {!prerequisites?.librealsense && (
              <div className="mt-2 pl-6">
                <p className="text-xs leading-relaxed text-red-700 dark:text-red-400">
                  Required for the depth camera. Install following the{' '}
                  <a
                    href="https://github.com/IntelRealSense/librealsense/blob/master/doc/distribution_linux.md"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2"
                  >
                    official instructions
                  </a>
                  :
                </p>
                <pre className="mt-2 max-w-full overflow-x-auto rounded-md bg-red-100 px-3 py-2 font-mono text-xs leading-relaxed text-red-900 select-all dark:bg-red-900/40 dark:text-red-200">
                  {`sudo apt-get install apt-transport-https

sudo mkdir -p /etc/apt/keyrings
curl -sSf https://librealsense.realsenseai.com/Debian/librealsenseai.asc | \
gpg --dearmor | sudo tee /etc/apt/keyrings/librealsenseai.gpg > /dev/null

echo "deb [signed-by=/etc/apt/keyrings/librealsenseai.gpg] https://librealsense.realsenseai.com/Debian/apt-repo $(lsb_release -cs) main" | \
sudo tee /etc/apt/sources.list.d/librealsense.list

sudo apt-get update
sudo apt-get install librealsense2 librealsense2-utils`}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* Continue button — only if any prerequisite fails (allows override) */}
        <div className="mt-6 flex items-center gap-3">
          {allPassed ? (
            <p className="text-sm text-green-700 dark:text-green-400">
              All prerequisites met. Advancing…
            </p>
          ) : (
            <Button variant="outline" onClick={onContinue} className="gap-1.5">
              Continue Anyway
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Step 2: Robot Setup ────────────────────────────────────────────

function RobotSetupStep({
  availableRobotTypes,
  availableRobotPorts,
  selectedSetupRobotType,
  setSelectedSetupRobotType,
  selectedSetupRobotPort,
  setSelectedSetupRobotPort,
  isSettingRobotType,
  robotTypeSetError,
  handleConfirmRobotType,
  onContinue,
}: {
  availableRobotTypes: string[]
  availableRobotPorts: {
    device: string
    description: string
    manufacturer: string
  }[]
  selectedSetupRobotType: string
  setSelectedSetupRobotType: (type: string) => void
  selectedSetupRobotPort: string
  setSelectedSetupRobotPort: (port: string) => void
  isSettingRobotType: boolean
  robotTypeSetError: string | null
  handleConfirmRobotType: () => Promise<boolean>
  onContinue: () => void
}) {
  return (
    <div className="glass-card relative overflow-hidden rounded-xl">
      <div className="from-primary/[0.04] via-secondary/[0.02] pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent" />
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center sm:py-20">
        <div className="mb-6">
          <div className="bg-primary/10 ring-primary/20 flex h-20 w-20 items-center justify-center rounded-2xl ring-1">
            <Usb className="text-primary h-9 w-9" />
          </div>
        </div>

        <h3 className="text-foreground text-xl font-semibold tracking-tight">
          Connect Robot Arm
        </h3>
        <p className="text-muted-foreground mt-2 max-w-sm text-sm leading-relaxed">
          Select the arm type and serial port, then connect.
        </p>

        <div className="mt-8 w-full max-w-sm space-y-4 text-left">
          <div>
            <label
              htmlFor="setup-robot-type"
              className="text-foreground block text-sm font-medium"
            >
              Robot Type
            </label>
            <select
              id="setup-robot-type"
              value={selectedSetupRobotType}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                setSelectedSetupRobotType(e.target.value)
              }
              className="border-input bg-background text-foreground mt-1 w-full rounded-lg border px-3 py-2 text-sm shadow-sm focus:ring-2 focus:outline-none"
            >
              <option value="" disabled>
                Select a robot type
              </option>
              {availableRobotTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          {selectedSetupRobotType === 'SO-ARM101' && (
            <div>
              <label
                htmlFor="setup-robot-port"
                className="text-foreground block text-sm font-medium"
              >
                Robot Port
              </label>
              {availableRobotPorts.length > 0 ? (
                <select
                  id="setup-robot-port"
                  value={selectedSetupRobotPort}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                    setSelectedSetupRobotPort(e.target.value)
                  }
                  className="border-input bg-background text-foreground mt-1 w-full rounded-lg border px-3 py-2 text-sm shadow-sm focus:ring-2 focus:outline-none"
                >
                  <option value="">Auto-detect (default)</option>
                  {availableRobotPorts.map(
                    (port: { device: string; description: string }) => (
                      <option key={port.device} value={port.device}>
                        {port.device}
                        {port.description ? ` — ${port.description}` : ''}
                      </option>
                    ),
                  )}
                </select>
              ) : (
                <input
                  id="setup-robot-port"
                  type="text"
                  placeholder="/dev/ttyACM0"
                  value={selectedSetupRobotPort}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setSelectedSetupRobotPort(e.target.value)
                  }
                  className="border-input bg-background text-foreground mt-1 w-full rounded-lg border px-3 py-2 text-sm shadow-sm focus:ring-2 focus:outline-none"
                />
              )}
              <p className="text-muted-foreground mt-1 text-xs">
                Select the serial port your robot arm is connected to.
              </p>
            </div>
          )}
          {robotTypeSetError && (
            <p className="text-destructive text-sm">{robotTypeSetError}</p>
          )}
          <Button
            size="lg"
            className="shadow-primary/10 w-full shadow-lg"
            disabled={!selectedSetupRobotType || isSettingRobotType}
            onClick={async () => {
              const success = await handleConfirmRobotType()
              if (success) onContinue()
            }}
          >
            {isSettingRobotType && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Connect
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Motor Readings Table ───────────────────────────────────────────

function MotorReadingsTable({ readings }: { readings: JointReading[] }) {
  if (readings.length === 0) {
    return (
      <div className="bg-muted text-muted-foreground rounded-lg px-3 py-2 text-xs">
        Waiting for joint readings…
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50 border-b">
            <th className="text-muted-foreground px-3 py-1.5 text-left font-medium">
              Joint
            </th>
            <th className="text-muted-foreground px-3 py-1.5 text-right font-medium">
              Min
            </th>
            <th className="text-muted-foreground px-3 py-1.5 text-right font-medium">
              Position
            </th>
            <th className="text-muted-foreground px-3 py-1.5 text-right font-medium">
              Max
            </th>
          </tr>
        </thead>
        <tbody>
          {readings.map((joint) => (
            <tr key={joint.name} className="border-b last:border-0">
              <td className="text-foreground px-3 py-1.5 font-medium">
                {joint.name.replace(/_/g, ' ')}
              </td>
              <td className="px-3 py-1.5 text-right font-mono text-blue-600 dark:text-blue-400">
                {joint.min}
              </td>
              <td className="px-3 py-1.5 text-right font-mono">{joint.pos}</td>
              <td className="px-3 py-1.5 text-right font-mono text-orange-600 dark:text-orange-400">
                {joint.max}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Step 3: Calibration ────────────────────────────────────────────

function CalibrationStep({
  calibrationStatus,
  motorCalibrationState,
  motorCalibrationJointReadings,
  isMotorCalibrationStarting,
  isMotorCalibrationNexting,
  motorCalibrationError,
  motorCalibrationMessage,
  handleMotorCalibrationStart,
  handleMotorCalibrationNext,
  motorCalibrationChoice,
  setMotorCalibrationChoice,
  motorCalibrationDialogOpen,
  setMotorCalibrationDialogOpen,
  gripperOpen,
  gripperClose,
  setGripperOpen,
  setGripperClose,
  isSavingGripperConfig,
  gripperConfigError,
  gripperConfigMessage,
  handleSaveGripperConfig,
  calibrationState,
  isCalibrationStarting,
  isCalibrationConfirming,
  calibrationError,
  calibrationMessage,
  handleCalibrationStart,
  handleCalibrationConfirm,
  arucoDetectResult,
  isArucoPolling,
  setIsArucoPolling,
  isArucoCalibrating,
  arucoError,
  arucoMessage,
  handleArucoCalibrate,
  layoutDialogOpen,
  setLayoutDialogOpen,
  workerBaseUrl,
  isReloadingCamera,
  cameraStatusMessage,
  handleReloadCamera,
  onProceed,
}: {
  calibrationStatus:
    | { motor_calibrated: boolean; camera_calibrated: boolean }
    | undefined
  motorCalibrationState: string
  motorCalibrationJointReadings: JointReading[]
  isMotorCalibrationStarting: boolean
  isMotorCalibrationNexting: boolean
  motorCalibrationError: string | null
  motorCalibrationMessage: string | null
  handleMotorCalibrationStart: () => Promise<void>
  handleMotorCalibrationNext: (choice?: 'use_existing' | 'run') => Promise<void>
  motorCalibrationChoice: 'use_existing' | 'run' | null
  setMotorCalibrationChoice: (v: 'use_existing' | 'run' | null) => void
  motorCalibrationDialogOpen: boolean
  setMotorCalibrationDialogOpen: (v: boolean) => void
  gripperOpen: number
  gripperClose: number
  setGripperOpen: (v: number) => void
  setGripperClose: (v: number) => void
  isSavingGripperConfig: boolean
  gripperConfigError: string | null
  gripperConfigMessage: string | null
  handleSaveGripperConfig: () => Promise<void>
  calibrationState: string
  isCalibrationStarting: boolean
  isCalibrationConfirming: boolean
  calibrationError: string | null
  calibrationMessage: string | null
  handleCalibrationStart: () => Promise<void>
  handleCalibrationConfirm: () => Promise<void>
  arucoDetectResult: ArucoDetectResult | null
  isArucoPolling: boolean
  setIsArucoPolling: (v: boolean) => void
  isArucoCalibrating: boolean
  arucoError: string | null
  arucoMessage: string | null
  handleArucoCalibrate: () => Promise<void>
  layoutDialogOpen: boolean
  setLayoutDialogOpen: (v: boolean) => void
  workerBaseUrl: string
  isReloadingCamera: boolean
  cameraStatusMessage: string
  handleReloadCamera: () => Promise<void>
  onProceed: () => void
}) {
  const isFullyCalibrated =
    calibrationStatus?.motor_calibrated && calibrationStatus?.camera_calibrated

  return (
    <div className="space-y-6">
      {/* Status summary */}
      <div className="glass-card relative overflow-hidden rounded-xl px-6 py-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-warning/10 ring-warning/20 flex h-10 w-10 items-center justify-center rounded-xl ring-1">
              <Settings2 className="text-warning h-5 w-5" />
            </div>
            <div>
              <h3 className="text-foreground text-lg font-semibold">
                Calibration
              </h3>
              <p className="text-muted-foreground text-sm">
                {isFullyCalibrated
                  ? 'Robot is calibrated and ready to use.'
                  : 'Complete the steps below to calibrate the robot.'}
              </p>
            </div>
          </div>
          <Button onClick={onProceed} className="gap-1.5">
            {isFullyCalibrated ? 'Proceed to App' : 'Skip & Proceed'}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Quick status badges */}
        <div className="mt-4 flex flex-wrap gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1',
              calibrationStatus?.motor_calibrated
                ? 'bg-green-50 text-green-700 ring-green-200 dark:bg-green-900/20 dark:text-green-400 dark:ring-green-700/40'
                : 'bg-muted text-muted-foreground ring-border',
            )}
          >
            {calibrationStatus?.motor_calibrated ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <XCircle className="h-3.5 w-3.5" />
            )}
            Motor Calibration
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1',
              calibrationStatus?.camera_calibrated
                ? 'bg-green-50 text-green-700 ring-green-200 dark:bg-green-900/20 dark:text-green-400 dark:ring-green-700/40'
                : 'bg-muted text-muted-foreground ring-border',
            )}
          >
            {calibrationStatus?.camera_calibrated ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <XCircle className="h-3.5 w-3.5" />
            )}
            Camera Calibration
          </span>
        </div>
      </div>

      {/* Calibration steps */}
      <div className="glass-card relative overflow-hidden rounded-xl px-6 py-6">
        <div className="space-y-6">
          {/* Step 0: Motor calibration */}
          <div className="flex gap-3">
            <div className="bg-warning/10 ring-warning/20 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-1">
              1
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <p className="text-sm font-semibold">Calibrate robot motors</p>
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                  Required on first connection. Follows the{' '}
                  <strong>Follower</strong> steps from the{' '}
                  <a
                    href="https://huggingface.co/docs/lerobot/so101#calibrate"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline underline-offset-2"
                  >
                    LeRobot SO-101 Calibrate docs
                  </a>
                  .
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setMotorCalibrationDialogOpen(true)}
                  className="gap-1.5"
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  Show Example Pose
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    isMotorCalibrationStarting ||
                    motorCalibrationState === 'awaiting_calibration_choice' ||
                    motorCalibrationState === 'awaiting_middle_position' ||
                    motorCalibrationState === 'awaiting_range_motion'
                  }
                  onClick={async () => await handleMotorCalibrationStart()}
                  className="gap-1.5"
                >
                  {isMotorCalibrationStarting && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  {isMotorCalibrationStarting
                    ? 'Starting…'
                    : motorCalibrationState === 'complete'
                      ? 'Re-calibrate'
                      : 'Start Motor Calibration'}
                </Button>

                {motorCalibrationState === 'awaiting_calibration_choice' && (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isMotorCalibrationNexting}
                      onClick={async () => {
                        setMotorCalibrationChoice('use_existing')
                        await handleMotorCalibrationNext('use_existing')
                      }}
                      className="gap-1.5"
                    >
                      {isMotorCalibrationNexting &&
                      motorCalibrationChoice === 'use_existing' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      Use Existing
                    </Button>
                    <Button
                      size="sm"
                      disabled={isMotorCalibrationNexting}
                      onClick={async () => {
                        setMotorCalibrationChoice('run')
                        await handleMotorCalibrationNext('run')
                      }}
                      className="gap-1.5"
                    >
                      {isMotorCalibrationNexting &&
                      motorCalibrationChoice === 'run' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      Run New
                    </Button>
                  </>
                )}

                {(motorCalibrationState === 'awaiting_middle_position' ||
                  motorCalibrationState === 'awaiting_range_motion') && (
                  <Button
                    size="sm"
                    disabled={isMotorCalibrationNexting}
                    onClick={async () => await handleMotorCalibrationNext()}
                    className="gap-1.5"
                  >
                    {isMotorCalibrationNexting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                    {isMotorCalibrationNexting ? 'Confirming…' : 'Confirm'}
                  </Button>
                )}
              </div>

              {motorCalibrationState === 'awaiting_calibration_choice' && (
                <p className="text-muted-foreground text-xs">
                  Existing calibration found. <strong>Use Existing</strong> to
                  apply, or <strong>Run New</strong> to recalibrate.
                </p>
              )}
              {motorCalibrationState === 'awaiting_middle_position' && (
                <p className="text-muted-foreground text-xs">
                  Move all joints to the <strong>middle</strong> of their range,
                  then click <strong>Confirm</strong>.
                </p>
              )}
              {motorCalibrationState === 'awaiting_range_motion' && (
                <p className="text-muted-foreground text-xs">
                  Slowly move each joint through its{' '}
                  <strong>full range of motion</strong>, then click{' '}
                  <strong>Confirm</strong>.
                </p>
              )}

              {motorCalibrationMessage && !motorCalibrationError && (
                <p className="text-xs text-green-600 dark:text-green-400">
                  {motorCalibrationMessage}
                </p>
              )}
              {motorCalibrationError && (
                <p className="text-destructive text-xs">
                  {motorCalibrationError}
                </p>
              )}

              {/* Parsed joint readings table — shown during active calibration */}
              {motorCalibrationJointReadings.length > 0 &&
                (motorCalibrationState === 'awaiting_middle_position' ||
                  motorCalibrationState === 'awaiting_range_motion') && (
                  <MotorReadingsTable
                    readings={motorCalibrationJointReadings}
                  />
                )}

              {/* Connection success — shown when complete */}
              {motorCalibrationState === 'complete' && (
                <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 ring-1 ring-green-200 dark:bg-green-900/20 dark:ring-green-700/40">
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <p className="text-xs font-medium text-green-700 dark:text-green-400">
                    Motor calibration complete. Robot arm reconnected.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="border-border border-t" />

          {/* Step 1: Arm to pick position */}
          <div className="flex gap-3">
            <div className="bg-warning/10 ring-warning/20 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-1">
              2
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <p className="text-sm font-semibold">
                  Move arm to pick position
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                  Move the arm to home, open the gripper, and position at the
                  target pick location.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="gripper-open"
                    className="text-foreground block text-xs font-medium"
                  >
                    Gripper Open
                  </label>
                  <input
                    id="gripper-open"
                    type="number"
                    step="0.1"
                    value={gripperOpen}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setGripperOpen(Number(e.target.value))
                    }
                    className="border-input bg-background text-foreground mt-1 w-full rounded-lg border px-3 py-1.5 text-sm focus:ring-2 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="gripper-close"
                    className="text-foreground block text-xs font-medium"
                  >
                    Gripper Close
                  </label>
                  <input
                    id="gripper-close"
                    type="number"
                    step="0.1"
                    value={gripperClose}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setGripperClose(Number(e.target.value))
                    }
                    className="border-input bg-background text-foreground mt-1 w-full rounded-lg border px-3 py-1.5 text-sm focus:ring-2 focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isSavingGripperConfig}
                  onClick={async () => await handleSaveGripperConfig()}
                  className="gap-1.5"
                >
                  {isSavingGripperConfig ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  {isSavingGripperConfig ? 'Saving…' : 'Save Gripper Config'}
                </Button>
              </div>
              {gripperConfigMessage && !gripperConfigError && (
                <p className="text-xs text-green-600 dark:text-green-400">
                  {gripperConfigMessage}
                </p>
              )}
              {gripperConfigError && (
                <p className="text-destructive text-xs">{gripperConfigError}</p>
              )}

              <div className="border-border border-t" />

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    isCalibrationStarting ||
                    isCalibrationConfirming ||
                    calibrationState === 'awaiting_confirmation'
                  }
                  onClick={async () => await handleCalibrationStart()}
                  className="gap-1.5"
                >
                  {isCalibrationStarting && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  {isCalibrationStarting ? 'Moving arm…' : 'Start Calibration'}
                </Button>

                {calibrationState === 'awaiting_confirmation' && (
                  <Button
                    size="sm"
                    disabled={isCalibrationConfirming}
                    onClick={async () => await handleCalibrationConfirm()}
                    className="gap-1.5"
                  >
                    {isCalibrationConfirming ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                    {isCalibrationConfirming
                      ? 'Confirming…'
                      : 'Confirm Position'}
                  </Button>
                )}
              </div>

              {calibrationMessage && !calibrationError && (
                <p className="text-xs text-green-600 dark:text-green-400">
                  {calibrationMessage}
                </p>
              )}
              {calibrationError && (
                <p className="text-destructive text-xs">{calibrationError}</p>
              )}
              {calibrationState === 'awaiting_confirmation' &&
                !calibrationError && (
                  <p className="text-muted-foreground text-xs">
                    Arm is at the pick position. Verify alignment in the camera
                    feed, then click <strong>Confirm Position</strong>.
                  </p>
                )}
            </div>
          </div>

          <div className="border-border border-t" />

          {/* Step 2: Camera ArUco calibration */}
          <div className="flex gap-3">
            <div className="bg-warning/10 ring-warning/20 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-1">
              3
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <p className="text-sm font-semibold">
                  Calibrate camera (workspace bounding box)
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                  Place two ArUco markers (4×4, ID 0 upper-left, ID 1
                  lower-right) then detect and save.
                </p>
              </div>

              {isArucoPolling && arucoDetectResult && (
                <div
                  className={cn(
                    'rounded-lg px-3 py-2 text-xs',
                    arucoDetectResult.detected
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {arucoDetectResult.message}
                  {arucoDetectResult.detected && arucoDetectResult.bbox && (
                    <span className="ml-1 font-mono">
                      {`bbox: [${arucoDetectResult.bbox.join(', ')}]`}
                    </span>
                  )}
                </div>
              )}

              {isArucoPolling &&
                arucoDetectResult?.detected &&
                arucoDetectResult.centroid && (
                  <div
                    className={cn(
                      'rounded-lg px-3 py-2 text-xs',
                      arucoDetectResult.aligned
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
                    )}
                  >
                    {arucoDetectResult.aligned ? (
                      <span className="font-medium">
                        ✓ Board centroid aligned with camera center
                      </span>
                    ) : (
                      <>
                        <span className="font-medium">
                          Align board centroid with camera center
                        </span>
                        {arucoDetectResult.offset_x !== null &&
                          arucoDetectResult.offset_y !== null && (
                            <span className="ml-1 font-mono">
                              {`offset: (${arucoDetectResult.offset_x != null && arucoDetectResult.offset_x > 0 ? '+' : ''}${arucoDetectResult.offset_x}, ${arucoDetectResult.offset_y != null && arucoDetectResult.offset_y > 0 ? '+' : ''}${arucoDetectResult.offset_y}) px`}
                            </span>
                          )}
                      </>
                    )}
                  </div>
                )}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setLayoutDialogOpen(true)}
                  className="gap-1.5"
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  Show Example Layout
                </Button>

                <Button
                  size="sm"
                  variant={isArucoPolling ? 'secondary' : 'outline'}
                  onClick={() => setIsArucoPolling(!isArucoPolling)}
                  className="gap-1.5"
                >
                  {isArucoPolling ? 'Stop Detection' : 'Start Detection'}
                </Button>

                <Button
                  size="sm"
                  disabled={isArucoCalibrating}
                  onClick={async () => await handleArucoCalibrate()}
                  className="gap-1.5"
                >
                  {isArucoCalibrating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  {isArucoCalibrating ? 'Saving…' : 'Save Bounding Box'}
                </Button>
              </div>

              {arucoMessage && !arucoError && (
                <p className="text-xs text-green-600 dark:text-green-400">
                  {arucoMessage}
                </p>
              )}
              {arucoError && (
                <p className="text-destructive text-xs">{arucoError}</p>
              )}

              {/* Live camera feed — inline with step 3 while detection is active */}
              {isArucoPolling && (
                <div className="mt-2 space-y-2">
                  <div
                    className="bg-muted relative w-full overflow-hidden rounded-lg"
                    style={{ aspectRatio: '16/9' }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className="absolute inset-0 h-full w-full object-contain"
                      src={`${workerBaseUrl}/stream/camera`}
                      alt="MJPEG stream"
                    />
                  </div>
                  <div className="flex items-center justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isReloadingCamera}
                      onClick={async () => await handleReloadCamera()}
                      className="gap-1.5"
                    >
                      <RefreshCcw
                        className={cn(
                          'h-3.5 w-3.5',
                          isReloadingCamera && 'animate-spin',
                        )}
                      />
                      {isReloadingCamera ? 'Reloading…' : 'Reload Camera'}
                    </Button>
                  </div>
                  {cameraStatusMessage && (
                    <p className="text-muted-foreground text-xs">
                      {cameraStatusMessage}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <Dialog
        open={motorCalibrationDialogOpen}
        onOpenChange={setMotorCalibrationDialogOpen}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Example Robot Pose After Calibration</DialogTitle>
          </DialogHeader>
          <Image
            src="/robotics-ai-calib-step0.jpg"
            alt="Example of correct robot arm pose after motor calibration"
            width={800}
            height={600}
            className="w-full rounded-lg object-contain"
          />
        </DialogContent>
      </Dialog>

      <Dialog open={layoutDialogOpen} onOpenChange={setLayoutDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Example ArUco Marker Layout</DialogTitle>
          </DialogHeader>
          <Image
            src="/robotics-ai-calib-step2.png"
            alt="Example ArUco marker layout showing correct placement of markers ID 0 and ID 1"
            width={800}
            height={600}
            className="w-full rounded-lg object-contain"
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Step 4: Main Application ───────────────────────────────────────

interface ToolOption {
  id: string
  name: string
  server?: string
  description?: string
}

function AppStep({
  workerBaseUrl,
  isConnected,
  setIsConnected,
  mcpStatus,
  mcpStatusMessage,
  mcpStatusClass,
  mcpStatusLabel,
  messages,
  input,
  setInput,
  isLoading,
  availableTools,
  selectedToolId,
  setSelectedToolId,
  selectedTool,
  isListening,
  isTranscribing,
  micError,
  micLanguage,
  micLanguageOptions,
  selectedMicLanguageLabel,
  isReloadingCamera,
  cameraStatusMessage,
  micButtonDisabled,
  imgRef,
  chatMessagesRef,
  handleMicLanguageChange,
  handleReset,
  sendMessage,
  handleSuggestionClick,
  handleReloadCamera,
  connectMcpServer,
  handleMicStartListening,
  handleMicStopListening,
  useMcp,
  setUseMcp,
  onBackToCalibration,
}: {
  workerBaseUrl: string
  isConnected: boolean
  setIsConnected: (v: boolean) => void
  mcpStatus: 'disconnected' | 'connecting' | 'connected' | 'error'
  mcpStatusMessage: string
  mcpStatusClass: string
  mcpStatusLabel: string
  messages: UIMessage[]
  input: string
  setInput: (v: string) => void
  isLoading: boolean
  availableTools: ToolOption[]
  selectedToolId: string
  setSelectedToolId: (id: string) => void
  selectedTool: ToolOption | undefined
  isListening: boolean
  isTranscribing: boolean
  micError: string | null
  micLanguage: string
  micLanguageOptions: { label: string; value: string }[]
  selectedMicLanguageLabel: string
  isReloadingCamera: boolean
  cameraStatusMessage: string
  micButtonDisabled: boolean
  imgRef: React.RefObject<HTMLImageElement | null>
  chatMessagesRef: React.RefObject<HTMLDivElement | null>
  handleMicLanguageChange: (lang: string) => void
  handleReset: () => void
  sendMessage: (content: string) => Promise<void>
  handleSuggestionClick: (suggestion: string) => void
  handleReloadCamera: () => Promise<void>
  connectMcpServer: () => Promise<void>
  handleMicStartListening: () => void
  handleMicStopListening: () => void
  useMcp: boolean
  setUseMcp: (v: boolean) => void
  onBackToCalibration: () => void
}) {
  return (
    <div className="space-y-6">
      {/* Settings accordion */}
      <Accordion
        type="single"
        collapsible
        className="glass-card relative overflow-hidden rounded-xl"
      >
        <AccordionItem value="settings" className="border-none">
          <AccordionTrigger className="px-6">
            <div className="flex w-full items-center gap-3 text-left">
              <div className="bg-muted ring-border flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1">
                <Settings2 className="text-muted-foreground h-4 w-4" />
              </div>
              <div className="flex-1">
                <p className="text-base font-semibold">Settings</p>
                <p className="text-muted-foreground text-sm">
                  Manage server connection, microphone and robot controls.
                </p>
              </div>
              <div className="mr-3 flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                    mcpStatusClass,
                  )}
                >
                  {mcpStatusLabel}
                </span>
                <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
                  {selectedMicLanguageLabel}
                </span>
                <Button size="sm" variant="ghost" asChild className="text-xs">
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation()
                      onBackToCalibration()
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation()
                        onBackToCalibration()
                      }
                    }}
                  >
                    Recalibrate
                  </span>
                </Button>
              </div>
            </div>
          </AccordionTrigger>

          <AccordionContent className="px-6 pb-6">
            <div className="grid gap-4 lg:grid-cols-2">
              {/* MCP / Tool settings */}
              <section className="glass-card relative overflow-hidden rounded-xl p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">Tool Settings</h3>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      Manage MCP server connection.
                    </p>
                  </div>
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                      mcpStatusClass,
                    )}
                  >
                    {mcpStatusLabel}
                  </span>
                </div>
                <p className="text-muted-foreground mt-2 text-xs">
                  {mcpStatusMessage}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant={
                      mcpStatus === 'connected' ? 'secondary' : 'default'
                    }
                    disabled={mcpStatus === 'connecting'}
                    onClick={async () => await connectMcpServer()}
                  >
                    {mcpStatus === 'connected' ? 'Reconnect' : 'Connect'}
                  </Button>
                  <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Use Tools</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={useMcp}
                      onClick={() => setUseMcp(!useMcp)}
                      className={cn(
                        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
                        useMcp ? 'bg-primary' : 'bg-muted',
                      )}
                    >
                      <span
                        className={cn(
                          'bg-background inline-block h-3.5 w-3.5 rounded-full shadow-sm transition-transform',
                          useMcp ? 'translate-x-4' : 'translate-x-0.5',
                        )}
                      />
                    </button>
                  </label>
                </div>

                {mcpStatus === 'connected' && (
                  <div className="mt-4">
                    {availableTools.length > 0 ? (
                      <>
                        <label
                          htmlFor="mcp-tool-select"
                          className="text-foreground block text-xs font-medium"
                        >
                          Available Tools
                        </label>
                        <select
                          id="mcp-tool-select"
                          value={selectedToolId}
                          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                            setSelectedToolId(e.target.value)
                          }
                          className="border-input bg-background text-foreground mt-1 block w-full rounded-lg border px-3 py-2 text-sm shadow-sm focus:ring-2 focus:outline-none"
                        >
                          <option value="">Use all available tools</option>
                          {availableTools.map((tool) => (
                            <option key={tool.id} value={tool.id}>
                              {tool.server
                                ? `${tool.server} • ${tool.name}`
                                : tool.name}
                            </option>
                          ))}
                        </select>
                        {selectedTool?.description && selectedToolId && (
                          <p className="text-muted-foreground mt-1.5 text-xs">
                            {selectedTool.description}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-muted-foreground bg-muted mt-3 rounded-lg px-3 py-3 text-xs">
                        No tools available for the connected MCP server.
                      </p>
                    )}
                  </div>
                )}
              </section>

              {/* Microphone settings */}
              <section className="glass-card relative overflow-hidden rounded-xl p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">Microphone</h3>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      Speech-to-text transcription options.
                    </p>
                  </div>
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                      isListening
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {isListening ? 'Listening' : 'Idle'}
                  </span>
                </div>
                <div className="mt-3 space-y-3">
                  <div>
                    <label
                      htmlFor="mic-language-select"
                      className="text-foreground block text-xs font-medium"
                    >
                      Transcription language
                    </label>
                    <select
                      id="mic-language-select"
                      value={micLanguage}
                      onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                        handleMicLanguageChange(e.target.value)
                      }
                      disabled={isListening}
                      className="border-input bg-background text-foreground mt-1 w-full rounded-lg border px-3 py-2 text-sm shadow-sm focus:ring-2 focus:outline-none disabled:opacity-50 sm:w-auto"
                    >
                      {micLanguageOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Main content: camera + chat */}
      <div className="grid grid-cols-1 gap-6 xl:h-[600px] xl:grid-cols-2">
        {/* Camera stream panel */}
        <div className="glass-card relative flex h-full flex-col overflow-hidden rounded-xl">
          <div className="border-border flex flex-col gap-2 border-b px-5 py-4 md:flex-row md:items-center md:justify-between">
            <h3 className="text-foreground flex items-center gap-2 text-base font-semibold">
              <Video className="h-5 w-5" /> Live Camera Stream
            </h3>
            <Button
              size="sm"
              variant="outline"
              disabled={isReloadingCamera}
              onClick={async () => await handleReloadCamera()}
              className="gap-1.5"
            >
              <RefreshCcw
                className={cn(
                  'h-3.5 w-3.5',
                  isReloadingCamera && 'animate-spin',
                )}
              />
              {isReloadingCamera ? 'Reloading…' : 'Reload Camera'}
            </Button>
          </div>
          {cameraStatusMessage && (
            <p className="text-muted-foreground px-5 pt-2 text-sm">
              {cameraStatusMessage}
            </p>
          )}
          <div className="flex min-h-0 flex-1 items-center p-5">
            <div
              className="bg-muted relative w-full overflow-hidden rounded-lg"
              style={{ aspectRatio: '16/9' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                className="absolute inset-0 h-full w-full object-contain"
                src={`${workerBaseUrl}/stream/camera`}
                alt="MJPEG stream"
                onLoad={() => setIsConnected(true)}
                onError={() => setIsConnected(false)}
              />
              {!isConnected && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <div className="text-center text-white">
                    <Video className="mx-auto mb-1 h-6 w-6" />
                    <p className="text-sm">Camera Disconnected</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Chat panel */}
        <div className="glass-card relative flex h-full flex-col overflow-hidden rounded-xl">
          <div className="border-border border-b px-5 py-4">
            <h3 className="text-foreground flex items-center gap-2 text-base font-semibold">
              <Brain className="h-5 w-5" /> AI Chat Assistant
            </h3>
          </div>

          {/* Messages */}
          <div
            ref={chatMessagesRef}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-smooth p-5"
          >
            {messages.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="text-muted-foreground text-center">
                  <div className="mb-3 text-4xl">🤖</div>
                  <p className="font-medium">Start a conversation!</p>
                  <p className="mt-1 text-sm">
                    Ask questions about the camera stream or robot.
                  </p>
                  <div className="mt-5 flex flex-col gap-2">
                    {DEFAULT_CHAT_SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        className={cn(
                          'border-border bg-muted hover:bg-muted/80 rounded-lg border px-3 py-2 text-sm transition-colors',
                          isLoading && 'cursor-not-allowed opacity-60',
                        )}
                        onClick={() => handleSuggestionClick(suggestion)}
                        disabled={isLoading}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => {
                  const textParts = message.parts.filter(
                    (p): p is { type: 'text'; text: string } =>
                      p.type === 'text',
                  )
                  const reasoningParts = message.parts.filter(
                    (p): p is { type: 'reasoning'; text: string } =>
                      p.type === 'reasoning',
                  )
                  const toolParts = message.parts.filter(isToolUIPart)
                  const visibleText = textParts.map((p) => p.text).join('')
                  const reasoningText = reasoningParts
                    .map((p) => p.text)
                    .join('\n\n')
                    .trim()
                  const isUser = message.role === 'user'
                  const isPendingAssistant =
                    !isUser &&
                    visibleText.trim().length === 0 &&
                    reasoningText.trim().length === 0 &&
                    toolParts.length === 0

                  return (
                    <div
                      key={message.id}
                      className={cn(
                        'flex',
                        isUser ? 'justify-end' : 'justify-start',
                      )}
                    >
                      <div
                        className={cn(
                          'max-w-[85%] rounded-xl px-4 py-3',
                          isUser
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-foreground',
                        )}
                      >
                        {isPendingAssistant ? (
                          <div className="flex items-center gap-1">
                            {[0, 0.1, 0.2].map((delay) => (
                              <div
                                key={delay}
                                className="bg-muted-foreground h-2 w-2 animate-bounce rounded-full"
                                style={{ animationDelay: `${delay}s` }}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="space-y-2 text-sm leading-relaxed">
                            {reasoningText && !isUser && (
                              <Accordion
                                type="single"
                                collapsible
                                className="border-border/50 bg-background rounded-lg border"
                              >
                                <AccordionItem
                                  value={`think-${message.id}`}
                                  className="border-none"
                                >
                                  <AccordionTrigger className="gap-2 px-3 py-2 text-xs font-semibold hover:no-underline">
                                    <Brain className="text-primary h-3.5 w-3.5 shrink-0" />
                                    Thinking process
                                  </AccordionTrigger>
                                  <AccordionContent className="px-3 pb-3 text-xs">
                                    <Streamdown
                                      components={{
                                        p: ({ children, ...props }) => (
                                          <div {...props}>{children}</div>
                                        ),
                                        ul: ({ children, ...props }) => (
                                          <ul
                                            {...props}
                                            className="my-1 list-disc space-y-0.5 pl-5"
                                          >
                                            {children}
                                          </ul>
                                        ),
                                        ol: ({ children, ...props }) => (
                                          <ol
                                            {...props}
                                            className="my-1 list-decimal space-y-0.5 pl-5"
                                          >
                                            {children}
                                          </ol>
                                        ),
                                      }}
                                    >
                                      {reasoningText}
                                    </Streamdown>
                                  </AccordionContent>
                                </AccordionItem>
                              </Accordion>
                            )}
                            {toolParts.length > 0 && !isUser && (
                              <Accordion
                                type="single"
                                collapsible
                                className="border-border/50 bg-background rounded-lg border"
                              >
                                {toolParts.map((tp) => {
                                  const isDone = tp.state === 'output-available'
                                  const isError = tp.state === 'output-error'
                                  const isRunning =
                                    tp.state === 'input-available' ||
                                    tp.state === 'input-streaming'
                                  const toolName = getToolName(tp)
                                  return (
                                    <AccordionItem
                                      key={tp.toolCallId}
                                      value={tp.toolCallId}
                                      className="border-none"
                                    >
                                      <AccordionTrigger className="gap-2 px-3 py-2 text-xs font-semibold hover:no-underline">
                                        {isRunning ? (
                                          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />
                                        ) : isDone ? (
                                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                                        ) : isError ? (
                                          <XCircle className="text-destructive h-3.5 w-3.5 shrink-0" />
                                        ) : (
                                          <Terminal className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                                        )}
                                        <span className="truncate">
                                          {toolName.replace(/_/g, ' ')}
                                        </span>
                                        {isRunning && (
                                          <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                                            running
                                          </span>
                                        )}
                                        {isDone && (
                                          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                                            completed
                                          </span>
                                        )}
                                      </AccordionTrigger>
                                      <AccordionContent className="space-y-2 px-3 pb-3 text-xs">
                                        {'input' in tp && tp.input != null && (
                                          <div>
                                            <p className="text-muted-foreground mb-1 text-[10px] font-medium uppercase">
                                              Input
                                            </p>
                                            <pre className="bg-muted/40 max-h-40 overflow-auto rounded-md p-2 text-[11px] break-words whitespace-pre-wrap">
                                              {typeof tp.input === 'string'
                                                ? tp.input
                                                : JSON.stringify(
                                                    tp.input,
                                                    null,
                                                    2,
                                                  )}
                                            </pre>
                                          </div>
                                        )}
                                        {isDone &&
                                          'output' in tp &&
                                          tp.output != null && (
                                            <div>
                                              <p className="text-muted-foreground mb-1 text-[10px] font-medium uppercase">
                                                Output
                                              </p>
                                              <pre className="bg-muted/40 max-h-40 overflow-auto rounded-md p-2 text-[11px] break-words whitespace-pre-wrap">
                                                {typeof tp.output === 'string'
                                                  ? tp.output
                                                  : JSON.stringify(
                                                      tp.output,
                                                      null,
                                                      2,
                                                    )}
                                              </pre>
                                            </div>
                                          )}
                                      </AccordionContent>
                                    </AccordionItem>
                                  )
                                })}
                              </Accordion>
                            )}
                            {visibleText.length > 0 && (
                              <Streamdown
                                components={{
                                  p: ({ children, ...props }) => (
                                    <div {...props}>{children}</div>
                                  ),
                                  ul: ({ children, ...props }) => (
                                    <ul
                                      {...props}
                                      className="my-1 list-disc space-y-0.5 pl-5"
                                    >
                                      {children}
                                    </ul>
                                  ),
                                  ol: ({ children, ...props }) => (
                                    <ol
                                      {...props}
                                      className="my-1 list-decimal space-y-0.5 pl-5"
                                    >
                                      {children}
                                    </ol>
                                  ),
                                }}
                              >
                                {visibleText}
                              </Streamdown>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Input area */}
          <div className="border-border border-t p-4">
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault()
                await sendMessage(input)
              }}
            >
              <input
                type="text"
                value={input}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setInput(e.target.value)
                }
                placeholder="Ask about the camera stream or AI analysis…"
                className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring flex-1 rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-none disabled:opacity-50"
                disabled={isLoading}
              />

              {/* Reset */}
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={handleReset}
                disabled={messages.length === 0 && !input.trim()}
                aria-label="Reset chat"
                title="Reset chat"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>

              {/* Mic */}
              <TooltipProvider>
                <Tooltip open={micError && !isListening ? undefined : false}>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={
                        isListening
                          ? handleMicStopListening
                          : handleMicStartListening
                      }
                      disabled={micButtonDisabled}
                      aria-label={
                        micError && !isListening
                          ? micError
                          : isListening
                            ? 'Stop microphone transcription'
                            : 'Start microphone transcription'
                      }
                      className={cn(
                        'text-white hover:text-white',
                        isListening
                          ? 'bg-orange-500 hover:bg-orange-600'
                          : micError
                            ? 'text-destructive hover:text-destructive border-destructive/50 border'
                            : 'bg-blue-400 hover:bg-blue-500',
                      )}
                    >
                      {isTranscribing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : isListening ? (
                        <Square className="h-4 w-4" />
                      ) : micError ? (
                        <MicOff className="h-4 w-4" />
                      ) : (
                        <Mic className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-56 text-center">
                    {micError}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {/* Send */}
              <Button
                type="submit"
                size="icon"
                disabled={!input.trim() || isLoading}
                aria-label="Send message"
                title="Send message"
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
