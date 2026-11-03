// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * The Robotics AI worker's API: system checks, the robot arm, its calibrations and the camera.
 * Pure functions of the worker's address; the hooks wrap them in queries and mutations.
 */

import { fetchJson, isHttpError, postJson } from '@/lib/browser/fetch-json'

export const ROBOTICS_SERVICE = 'Robotics AI'

/** Query keys of this sample, namespaced by the worker they read. */
export function roboticsKey(name: string, workerBaseUrl: string | undefined) {
  return ['robotics-ai', name, workerBaseUrl] as const
}

/** The answer most robot actions give: did it work, and what happened. */
interface ActionResponse {
  status: boolean
  message: string
}

/** A `POST` without a body, as the worker's action endpoints take it. */
function postAction<T>(url: string, errorMessage: string): Promise<T> {
  return fetchJson<T>(url, { method: 'POST', errorMessage })
}

export interface Prerequisites {
  dialout: boolean
  librealsense: boolean
}

export interface CalibrationStatus {
  motor_calibrated: boolean
  camera_calibrated: boolean
  calibration_dir: string
}

export interface RobotPort {
  device: string
  description: string
  manufacturer: string
}

export const fetchPrerequisites = (url: string) =>
  fetchJson<Prerequisites>(`${url}/system/prerequisites`, {
    errorMessage: 'Failed to fetch prerequisites.',
  })

export const fetchCalibrationStatus = (url: string) =>
  fetchJson<CalibrationStatus>(`${url}/robot/calibration-status`, {
    errorMessage: 'Failed to fetch calibration status.',
  })

export const fetchRobotType = (url: string) =>
  fetchJson<{ type: string | null }>(`${url}/robot/type`, {
    errorMessage: 'Failed to fetch robot type.',
  })

export const fetchRobotTypes = (url: string) =>
  fetchJson<{ types: string[] }>(`${url}/robot/types`, {
    errorMessage: 'Failed to fetch robot types.',
  })

export const fetchRobotPorts = (url: string) =>
  fetchJson<{ ports: RobotPort[] }>(`${url}/robot/ports`, {
    errorMessage: 'Failed to fetch robot ports.',
  })

export const setRobotType = (url: string, type: string, port?: string) =>
  postJson<ActionResponse & { type: string; port: string }>(
    `${url}/robot/type`,
    { type, port },
    { errorMessage: 'Failed to set robot type.' },
  )

export type MotorCalibrationState =
  | 'idle'
  | 'awaiting_calibration_choice'
  | 'awaiting_middle_position'
  | 'awaiting_range_motion'
  | 'complete'
  | 'error'

export type MotorCalibrationChoice = 'use_existing' | 'run'

/** The states in which a calibration waits for the user's next step. */
export function isMotorCalibrationWaiting(
  state: MotorCalibrationState,
): boolean {
  return (
    state === 'awaiting_calibration_choice' ||
    state === 'awaiting_middle_position' ||
    state === 'awaiting_range_motion'
  )
}

export interface JointReading {
  name: string
  min: number
  pos: number
  max: number
}

export interface MotorCalibrationAnswer {
  state: MotorCalibrationState
  message: string
}

export const fetchMotorCalibrationStatus = (url: string) =>
  fetchJson<{ state: MotorCalibrationState; joint_readings: JointReading[] }>(
    `${url}/robot/motor-calibrate/status`,
    { errorMessage: 'Failed to fetch motor calibration status.' },
  )

/** Starts a motor calibration; one already running (409) is resumed from the worker's status. */
export async function startMotorCalibration(
  url: string,
): Promise<MotorCalibrationAnswer> {
  try {
    return await postAction<MotorCalibrationAnswer>(
      `${url}/robot/motor-calibrate/start`,
      'Failed to start motor calibration.',
    )
  } catch (error) {
    if (!isHttpError(error, 409)) throw error
    const { state } = await fetchMotorCalibrationStatus(url)
    return {
      state,
      message: 'Calibration already in progress. Resuming from current step.',
    }
  }
}

export const advanceMotorCalibration = (
  url: string,
  choice?: MotorCalibrationChoice,
) =>
  postJson<MotorCalibrationAnswer>(
    `${url}/robot/motor-calibrate/next`,
    choice ? { choice } : undefined,
    { errorMessage: 'Failed to advance motor calibration.' },
  )

export interface GripperConfig {
  gripper_open: number
  gripper_close: number
}

export const fetchGripperConfig = (url: string) =>
  fetchJson<GripperConfig>(`${url}/robot/gripper-config`, {
    errorMessage: 'Failed to fetch gripper configuration.',
  })

export const saveGripperConfig = (url: string, config: GripperConfig) =>
  postJson<ActionResponse & GripperConfig>(
    `${url}/robot/gripper-config`,
    config,
    { errorMessage: 'Failed to save gripper configuration.' },
  )

/** Moves the arm to the pick position, then waits for a confirm. */
export const startArmCalibration = (url: string) =>
  postAction<ActionResponse>(
    `${url}/robot/calibrate/start`,
    'Failed to start calibration.',
  )

export const confirmArmCalibration = (url: string) =>
  postAction<ActionResponse>(
    `${url}/robot/calibrate/confirm`,
    'Failed to confirm calibration.',
  )

export interface ArucoDetectResult {
  detected: boolean
  bbox: [number, number, number, number] | null
  marker0_center: [number, number] | null
  marker1_center: [number, number] | null
  centroid: [number, number] | null
  frame_center: [number, number] | null
  aligned: boolean | null
  offset_x: number | null
  offset_y: number | null
  message: string
}

export const detectAruco = (url: string) =>
  fetchJson<ArucoDetectResult>(`${url}/camera/aruco-detect`, {
    errorMessage: 'Failed to detect ArUco markers.',
  })

export const calibrateAruco = (url: string) =>
  postAction<ArucoDetectResult & { status: boolean }>(
    `${url}/camera/aruco-calibrate`,
    'Camera calibration failed.',
  )

export const fetchCameraStatus = (url: string) =>
  fetchJson<{ ready: boolean }>(`${url}/camera/status`, {
    errorMessage: 'Failed to fetch camera status.',
  })

export const reloadCamera = (url: string) =>
  postAction<unknown>(`${url}/camera/reload`, 'Camera reload failed.')

export const connectMcp = async (url: string) =>
  (await postAction<{ message?: string; tools?: unknown } | undefined>(
    `${url}/api/mcp/connect`,
    'Failed to connect to MCP server.',
  )) ?? {}
