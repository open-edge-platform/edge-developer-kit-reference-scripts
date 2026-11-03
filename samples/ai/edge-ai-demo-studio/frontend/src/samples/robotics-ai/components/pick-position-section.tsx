// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useArmCalibration, useGripperConfig } from '../hooks/use-pick-position'
import {
  ActionResult,
  CalibrationStepCard,
  StepActionButton,
} from './calibration-parts'

/** Calibration step 2: the gripper's positions and the arm's pick position. */
export function PickPositionSection({
  workerBaseUrl,
}: {
  workerBaseUrl: string
}) {
  const gripper = useGripperConfig(workerBaseUrl)
  const arm = useArmCalibration(workerBaseUrl)

  return (
    <CalibrationStepCard
      step={2}
      title="Move arm to pick position"
      description="Move the arm to home, open the gripper, and position at the target pick location."
    >
      <div className="grid grid-cols-2 gap-3">
        <GripperField
          id="gripper-open"
          label="Gripper Open"
          value={gripper.open}
          onChange={gripper.setOpen}
        />
        <GripperField
          id="gripper-close"
          label="Gripper Close"
          value={gripper.close}
          onChange={gripper.setClose}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StepActionButton
          variant="outline"
          pending={gripper.isSaving}
          pendingLabel="Saving…"
          onClick={gripper.save}
        >
          Save Gripper Config
        </StepActionButton>
      </div>
      <ActionResult message={gripper.message} error={gripper.error} />

      <Separator />

      <div className="flex flex-wrap items-center gap-2">
        <StepActionButton
          variant="outline"
          icon={false}
          pending={arm.isStarting}
          pendingLabel="Moving arm…"
          disabled={arm.isConfirming || arm.awaitingConfirmation}
          onClick={arm.start}
        >
          Start Calibration
        </StepActionButton>
        {arm.awaitingConfirmation && (
          <StepActionButton
            pending={arm.isConfirming}
            pendingLabel="Confirming…"
            onClick={arm.confirm}
          >
            Confirm Position
          </StepActionButton>
        )}
      </div>

      <ActionResult message={arm.message} error={arm.error} />
      {arm.awaitingConfirmation && !arm.error && (
        <p className="text-muted-foreground text-xs">
          Arm is at the pick position. Verify alignment in the camera feed, then
          click <strong>Confirm Position</strong>.
        </p>
      )}
    </CalibrationStepCard>
  )
}

function GripperField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        step="0.1"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8"
      />
    </div>
  )
}
