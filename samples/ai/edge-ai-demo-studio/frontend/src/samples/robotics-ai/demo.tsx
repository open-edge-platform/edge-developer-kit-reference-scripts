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
  ImageIcon,
  Loader2,
  Mic,
  MicOff,
  RefreshCcw,
  RotateCcw,
  Send,
  Settings2,
  Square,
  TriangleAlert,
} from 'lucide-react'
import { Streamdown } from 'streamdown'
import { cn } from '@/lib/utils'
import type { Sample } from '../types'
import {
  DEFAULT_CHAT_SUGGESTIONS,
  useRoboticsAiDemo,
} from '@/services/robotics-ai/hooks'

// ── Component ─────────────────────────────────────────────────────

export function RoboticsAiDemo({ sample: _sample }: { sample: Sample }) {
  const [layoutDialogOpen, setLayoutDialogOpen] = useState(false)
  const [motorCalibrationDialogOpen, setMotorCalibrationDialogOpen] =
    useState(false)
  const [motorCalibrationChoice, setMotorCalibrationChoice] = useState<
    'use_existing' | 'run' | null
  >(null)

  const {
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
    robotTypeReady,
    isRobotTypeLoading,
    availableRobotTypes,
    selectedSetupRobotType,
    setSelectedSetupRobotType,
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
    motorCalibrationOutput,
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
  } = useRoboticsAiDemo()

  // ── Render ───────────────────────────────────────────────────────

  if (isRobotTypeLoading) {
    return (
      <div className="glass-card relative overflow-hidden rounded-xl">
        <div className="from-primary/[0.04] via-secondary/[0.02] pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent" />
        <div className="flex flex-col items-center justify-center px-6 py-20 text-center sm:py-28">
          <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
          <p className="text-muted-foreground mt-4 text-sm">
            Loading robot configuration…
          </p>
        </div>
      </div>
    )
  }

  if (!robotTypeReady) {
    return (
      <div className="glass-card relative overflow-hidden rounded-xl">
        <div className="from-primary/[0.04] via-secondary/[0.02] pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent" />

        <div className="flex flex-col items-center justify-center px-6 py-16 text-center sm:py-24">
          {/* Icon */}
          <div className="mb-6">
            <div className="bg-primary/10 ring-primary/20 flex h-20 w-20 items-center justify-center rounded-2xl ring-1">
              <Brain className="text-primary h-9 w-9" />
            </div>
          </div>

          {/* Heading */}
          <h3 className="text-foreground text-xl font-semibold tracking-tight">
            Configure Robot
          </h3>
          <p className="text-muted-foreground mt-2 max-w-sm text-sm leading-relaxed">
            Select the robot type to continue.
          </p>

          {/* Form fields */}
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
            {robotTypeSetError && (
              <p className="text-destructive text-sm">{robotTypeSetError}</p>
            )}
            <Button
              size="lg"
              className="shadow-primary/10 w-full shadow-lg"
              disabled={!selectedSetupRobotType || isSettingRobotType}
              onClick={async () => await handleConfirmRobotType()}
            >
              {isSettingRobotType && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Confirm
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Calibration Guide accordion */}
      <Accordion
        type="single"
        collapsible
        className="glass-card relative overflow-hidden rounded-xl"
      >
        {/* Accent bar */}
        <div className="from-warning/80 to-warning/30 h-1 bg-gradient-to-r" />
        <AccordionItem value="calibration" className="border-none">
          <AccordionTrigger className="px-6">
            <div className="flex w-full items-center gap-3 text-left">
              <div className="bg-warning/10 ring-warning/20 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1">
                <TriangleAlert className="text-warning h-4 w-4" />
              </div>
              <div>
                <p className="text-base font-semibold">Calibration Guide</p>
                <p className="text-muted-foreground text-sm">
                  Run calibration first if this is your first time using this
                  demo.
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6">
            <div className="space-y-6">
              {/* Prerequisite: dialout group */}
              <div className="rounded-lg bg-blue-50 px-4 py-3 ring-1 ring-blue-200 dark:bg-blue-900/20 dark:ring-blue-700/40">
                <p className="text-xs font-semibold text-blue-800 dark:text-blue-300">
                  Prerequisites — run once per machine
                </p>
                <p className="mt-1 text-xs leading-relaxed text-blue-700 dark:text-blue-400">
                  Add your user to the{' '}
                  <code className="font-mono font-bold">dialout</code> group so
                  the robot can be accessed without{' '}
                  <code className="font-mono">sudo</code>. Then log out and back
                  in (or run <code className="font-mono">newgrp dialout</code>{' '}
                  in the current terminal session).
                </p>
                <pre className="mt-2 rounded-md bg-blue-100 px-3 py-2 font-mono text-xs text-blue-900 select-all dark:bg-blue-900/40 dark:text-blue-200">
                  sudo usermod -aG dialout $USER
                </pre>
              </div>

              <div className="border-border border-t" />

              {/* Step 0 */}
              <div className="flex gap-3">
                <div className="bg-warning/10 ring-warning/20 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-1">
                  0
                </div>
                <div className="flex-1 space-y-3">
                  <div>
                    <p className="text-sm font-semibold">
                      Calibrate robot motors
                    </p>
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
                      . The robot arm will be disconnected automatically while
                      calibration runs.
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

                    {/* Start */}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        isMotorCalibrationStarting ||
                        motorCalibrationState ===
                          'awaiting_calibration_choice' ||
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

                    {/* Calibration choice — use existing or run new */}
                    {motorCalibrationState ===
                      'awaiting_calibration_choice' && (
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
                          Use Existing Calibration
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
                          Run New Calibration
                        </Button>
                      </>
                    )}

                    {/* Next — advance through both prompts */}
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

                  {/* Contextual instruction */}
                  {motorCalibrationState === 'awaiting_calibration_choice' && (
                    <p className="text-muted-foreground text-xs">
                      An existing calibration file was found. Click{' '}
                      <strong>Use Existing Calibration</strong> to apply it, or{' '}
                      <strong>Run New Calibration</strong> to recalibrate from
                      scratch.
                    </p>
                  )}
                  {motorCalibrationState === 'awaiting_middle_position' && (
                    <p className="text-muted-foreground text-xs">
                      Move all joints to the <strong>middle</strong> of their
                      range, then click <strong>Confirm</strong>.
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

                  {/* Live process output */}
                  {motorCalibrationOutput.length > 0 && (
                    <pre className="bg-muted text-muted-foreground max-h-32 overflow-y-auto rounded-lg px-3 py-2 text-xs leading-relaxed">
                      {motorCalibrationOutput.slice(-20).join('\n')}
                    </pre>
                  )}
                </div>
              </div>

              <div className="border-border border-t" />

              {/* Step 1 */}
              <div className="flex gap-3">
                <div className="bg-warning/10 ring-warning/20 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-1">
                  1
                </div>
                <div className="flex-1 space-y-3">
                  <div>
                    <p className="text-sm font-semibold">
                      Move arm to pick position
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                      Click <strong>Start Calibration</strong> to move the arm
                      to home, open the gripper, and apply the configured X/Y/Z
                      offsets to reach the target pick position. Verify
                      alignment using the live camera feed.
                    </p>
                  </div>

                  {/* Gripper config */}
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
                      {isSavingGripperConfig
                        ? 'Saving…'
                        : 'Save Gripper Config'}
                    </Button>
                  </div>
                  {gripperConfigMessage && !gripperConfigError && (
                    <p className="text-xs text-green-600 dark:text-green-400">
                      {gripperConfigMessage}
                    </p>
                  )}
                  {gripperConfigError && (
                    <p className="text-destructive text-xs">
                      {gripperConfigError}
                    </p>
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
                      {isCalibrationStarting
                        ? 'Moving arm…'
                        : 'Start Calibration'}
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
                    <p className="text-destructive text-xs">
                      {calibrationError}
                    </p>
                  )}
                  {calibrationState === 'awaiting_confirmation' &&
                    !calibrationError && (
                      <p className="text-muted-foreground text-xs">
                        Arm is at the pick position. Verify alignment in the
                        camera feed, then click{' '}
                        <strong>Confirm Position</strong> to complete the
                        calibration sequence.
                      </p>
                    )}
                </div>
              </div>

              <div className="border-border border-t" />

              {/* Step 2 */}
              <div className="flex gap-3">
                <div className="bg-warning/10 ring-warning/20 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-1">
                  2
                </div>
                <div className="flex-1 space-y-3">
                  <div>
                    <p className="text-sm font-semibold">
                      Calibrate camera (workspace bounding box)
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                      Place two ArUco markers on the workspace:
                    </p>
                    <ul className="text-muted-foreground mt-1.5 list-disc space-y-1 pl-4 text-xs">
                      <li>
                        <strong>Marker ID 0</strong> — upper-left corner
                      </li>
                      <li>
                        <strong>Marker ID 1</strong> — lower-right corner
                      </li>
                      <li>
                        Dictionary: <strong>4×4 (50)</strong>, size:{' '}
                        <strong>2 cm</strong>
                      </li>
                    </ul>
                    <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                      Enable live detection to verify both markers are visible
                      in the camera feed. Ensure the board centroid is aligned
                      with the camera center, then click{' '}
                      <strong>Save Bounding Box</strong> to persist the computed
                      workspace bbox to the config.
                    </p>
                  </div>

                  {/* Detection status */}
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

                  {/* Centroid alignment status */}
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
                                  {`offset: (${arucoDetectResult.offset_x > 0 ? '+' : ''}${arucoDetectResult.offset_x}, ${arucoDetectResult.offset_y > 0 ? '+' : ''}${arucoDetectResult.offset_y}) px`}
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
                </div>
              </div>
            </div>
          </AccordionContent>

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
        </AccordionItem>
      </Accordion>

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
                <div className="mt-3 flex flex-wrap gap-2">
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
              <span>📹</span> Live Camera Stream
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
                src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect width='100%25' height='100%25' fill='%23e2e8f0'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='%2394a3b8' font-size='14'%3ENo Stream%3C/text%3E%3C/svg%3E"
                alt="MJPEG stream"
                onLoad={() => setIsConnected(true)}
                onError={() => setIsConnected(false)}
              />
              {!isConnected && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <div className="text-center text-white">
                    <div className="mb-1 text-2xl">📹</div>
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
              <span>💬</span> AI Chat Assistant
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
                  const visibleText = textParts.map((p) => p.text).join('')
                  const reasoningText = reasoningParts
                    .map((p) => p.text)
                    .join('\n\n')
                    .trim()
                  const isUser = message.role === 'user'
                  const isPendingAssistant =
                    !isUser &&
                    visibleText.trim().length === 0 &&
                    reasoningText.trim().length === 0

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
