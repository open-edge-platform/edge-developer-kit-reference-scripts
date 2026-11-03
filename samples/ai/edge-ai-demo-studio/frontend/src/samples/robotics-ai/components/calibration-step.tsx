// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { CheckCircle2, ChevronRight, Settings2, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useCalibrationStatus } from '../hooks/use-motor-calibration'
import { ArucoSection } from './aruco-section'
import { MotorCalibrationSection } from './motor-calibration-section'
import { PickPositionSection } from './pick-position-section'

/** Wizard step 3: calibrate the motors, the pick position and the camera, or skip to the app. */
export function CalibrationStep({
  workerBaseUrl,
  robotTypeReady,
  onProceed,
}: {
  workerBaseUrl: string
  /** The worker has a robot type, so it can say what is calibrated. */
  robotTypeReady: boolean
  onProceed: () => void
}) {
  const { data: status } = useCalibrationStatus(workerBaseUrl, robotTypeReady)
  const isFullyCalibrated = Boolean(
    status?.motor_calibrated && status.camera_calibrated,
  )

  return (
    <div className="space-y-6">
      <div className="glass-card relative overflow-hidden rounded-xl px-6 py-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-warning/10 ring-warning/20 flex h-10 w-10 items-center justify-center rounded-xl ring-1">
              <Settings2 className="text-warning h-5 w-5" aria-hidden />
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
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <CalibratedBadge
            label="Motor Calibration"
            done={status?.motor_calibrated}
          />
          <CalibratedBadge
            label="Camera Calibration"
            done={status?.camera_calibrated}
          />
        </div>
      </div>

      <div className="glass-card relative space-y-6 overflow-hidden rounded-xl px-6 py-6">
        <MotorCalibrationSection workerBaseUrl={workerBaseUrl} />
        <Separator />
        <PickPositionSection workerBaseUrl={workerBaseUrl} />
        <Separator />
        <ArucoSection workerBaseUrl={workerBaseUrl} />
      </div>
    </div>
  )
}

function CalibratedBadge({
  label,
  done,
}: {
  label: string
  done: boolean | undefined
}) {
  return (
    <Badge tone={done ? 'success' : 'muted'} className="px-3 py-1">
      {done ? <CheckCircle2 aria-hidden /> : <XCircle aria-hidden />}
      {label}
      <span className="sr-only">
        {done ? ': calibrated' : ': not calibrated'}
      </span>
    </Badge>
  )
}
