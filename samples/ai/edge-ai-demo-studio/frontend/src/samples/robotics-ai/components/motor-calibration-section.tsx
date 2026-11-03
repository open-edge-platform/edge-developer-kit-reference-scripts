// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMotorCalibration } from '../hooks/use-motor-calibration'
import { isMotorCalibrationWaiting } from '../lib/api'
import {
  ActionResult,
  CalibrationStepCard,
  DoneBanner,
  ExampleImageButton,
  StepActionButton,
} from './calibration-parts'
import { MotorReadingsTable } from './motor-readings-table'

/** Calibration step 1: the motors, following LeRobot's follower calibration. */
export function MotorCalibrationSection({
  workerBaseUrl,
}: {
  workerBaseUrl: string
}) {
  const motors = useMotorCalibration(workerBaseUrl)
  const { state } = motors
  const choosing = state === 'awaiting_calibration_choice'
  const positioning =
    state === 'awaiting_middle_position' || state === 'awaiting_range_motion'

  return (
    <CalibrationStepCard
      step={1}
      title="Calibrate robot motors"
      description={
        <>
          Required on first connection. Follows the <strong>Follower</strong>{' '}
          steps from the{' '}
          <a
            href="https://huggingface.co/docs/lerobot/so101#calibrate"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            LeRobot SO-101 Calibrate docs
          </a>
          .
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <ExampleImageButton
          label="Show Example Pose"
          title="Example Robot Pose After Calibration"
          src="/robotics-ai-calib-step0.jpg"
          alt="Example of correct robot arm pose after motor calibration"
        />

        <StepActionButton
          variant="outline"
          icon={false}
          pending={motors.isStarting}
          pendingLabel="Starting…"
          disabled={isMotorCalibrationWaiting(state)}
          onClick={motors.start}
        >
          {state === 'complete' ? 'Re-calibrate' : 'Start Motor Calibration'}
        </StepActionButton>

        {choosing && (
          <>
            <StepActionButton
              variant="secondary"
              pending={motors.pendingChoice === 'use_existing'}
              disabled={motors.isAdvancing}
              onClick={() => motors.advance('use_existing')}
            >
              Use Existing
            </StepActionButton>
            <StepActionButton
              pending={motors.pendingChoice === 'run'}
              disabled={motors.isAdvancing}
              onClick={() => motors.advance('run')}
            >
              Run New
            </StepActionButton>
          </>
        )}

        {positioning && (
          <StepActionButton
            pending={motors.isAdvancing}
            pendingLabel="Confirming…"
            onClick={() => motors.advance()}
          >
            Confirm
          </StepActionButton>
        )}
      </div>

      {choosing && (
        <p className="text-muted-foreground text-xs">
          Existing calibration found. <strong>Use Existing</strong> to apply, or{' '}
          <strong>Run New</strong> to recalibrate.
        </p>
      )}
      {state === 'awaiting_middle_position' && (
        <p className="text-muted-foreground text-xs">
          Move all joints to the <strong>middle</strong> of their range, then
          click <strong>Confirm</strong>.
        </p>
      )}
      {state === 'awaiting_range_motion' && (
        <p className="text-muted-foreground text-xs">
          Slowly move each joint through its{' '}
          <strong>full range of motion</strong>, then click{' '}
          <strong>Confirm</strong>.
        </p>
      )}

      <ActionResult message={motors.message} error={motors.error} />

      {positioning && motors.jointReadings.length > 0 && (
        <MotorReadingsTable readings={motors.jointReadings} />
      )}

      {state === 'complete' && (
        <DoneBanner>
          Motor calibration complete. Robot arm reconnected.
        </DoneBanner>
      )}
    </CalibrationStepCard>
  )
}
