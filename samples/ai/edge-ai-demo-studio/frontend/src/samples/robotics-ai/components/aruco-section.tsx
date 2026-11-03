// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { TONES } from '@/components/common/tones'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useArucoCalibration } from '../hooks/use-aruco-calibration'
import type { ArucoDetectResult } from '../lib/api'
import {
  ActionResult,
  CalibrationStepCard,
  ExampleImageButton,
  StepActionButton,
} from './calibration-parts'
import { LiveCamera } from './live-camera'

/** `+12`, `-3`, `0`: an offset with its direction. */
function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

/** Calibration step 3: the camera's workspace, spanned by two ArUco markers. */
export function ArucoSection({ workerBaseUrl }: { workerBaseUrl: string }) {
  const aruco = useArucoCalibration(workerBaseUrl)

  return (
    <CalibrationStepCard
      step={3}
      title="Calibrate camera (workspace bounding box)"
      description="Place two ArUco markers (4×4, ID 0 upper-left, ID 1 lower-right) then detect and save."
    >
      {aruco.result && <DetectionReadout result={aruco.result} />}

      <div className="flex flex-wrap items-center gap-2">
        <ExampleImageButton
          label="Show Example Layout"
          title="Example ArUco Marker Layout"
          src="/robotics-ai-calib-step2.png"
          alt="Example ArUco marker layout showing correct placement of markers ID 0 and ID 1"
        />
        <Button
          size="sm"
          variant={aruco.detecting ? 'secondary' : 'outline'}
          aria-pressed={aruco.detecting}
          onClick={() => aruco.setDetecting(!aruco.detecting)}
        >
          {aruco.detecting ? 'Stop Detection' : 'Start Detection'}
        </Button>
        <StepActionButton
          pending={aruco.isSaving}
          pendingLabel="Saving…"
          onClick={aruco.save}
        >
          Save Bounding Box
        </StepActionButton>
      </div>

      <ActionResult message={aruco.message} error={aruco.error} />

      {aruco.detecting && (
        <LiveCamera workerBaseUrl={workerBaseUrl} className="mt-2" />
      )}
    </CalibrationStepCard>
  )
}

/** What the latest detection found, and how far the board is off centre. */
function DetectionReadout({ result }: { result: ArucoDetectResult }) {
  const { offset_x: dx, offset_y: dy } = result
  return (
    <div role="status" className="space-y-2">
      <p
        className={cn(
          'rounded-lg border px-3 py-2 text-xs',
          result.detected ? TONES.success.pill : TONES.muted.pill,
        )}
      >
        {result.message}
        {result.detected && result.bbox && (
          <span className="ml-1 font-mono">
            bbox: [{result.bbox.join(', ')}]
          </span>
        )}
      </p>
      {result.detected && result.centroid && (
        <p
          className={cn(
            'rounded-lg border px-3 py-2 text-xs',
            result.aligned ? TONES.success.pill : TONES.warning.pill,
          )}
        >
          {result.aligned ? (
            <span className="font-medium">
              ✓ Board centroid aligned with camera center
            </span>
          ) : (
            <>
              <span className="font-medium">
                Align board centroid with camera center
              </span>
              {dx !== null && dy !== null && (
                <span className="ml-1 font-mono">
                  offset: ({signed(dx)}, {signed(dy)}) px
                </span>
              )}
            </>
          )}
        </p>
      )}
    </div>
  )
}
