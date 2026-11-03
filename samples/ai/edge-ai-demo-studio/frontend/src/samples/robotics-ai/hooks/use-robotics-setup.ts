// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { requireApiBase } from '@/lib/browser/api-base'
import { getErrorMessage } from '@/lib/errors'
import {
  fetchPrerequisites,
  fetchRobotPorts,
  fetchRobotType,
  fetchRobotTypes,
  roboticsKey,
  ROBOTICS_SERVICE,
  setRobotType,
} from '../lib/api'

const KNOWN_ROBOT_TYPES = ['SO-ARM101']

/** Wizard steps 1-2: the system prerequisites, and the robot arm type and serial port to connect. */
export function useRoboticsSetup(workerBaseUrl: string | undefined) {
  const enabled = workerBaseUrl !== undefined
  const prerequisites = useQuery({
    queryKey: roboticsKey('prerequisites', workerBaseUrl),
    queryFn: () => {
      requireApiBase(workerBaseUrl, ROBOTICS_SERVICE)
      return fetchPrerequisites(workerBaseUrl)
    },
    enabled,
    retry: false,
    staleTime: 30_000,
  })
  const robotType = useQuery({
    queryKey: roboticsKey('robot-type', workerBaseUrl),
    queryFn: () => {
      requireApiBase(workerBaseUrl, ROBOTICS_SERVICE)
      return fetchRobotType(workerBaseUrl)
    },
    enabled,
    retry: false,
    staleTime: 0,
  })
  const robotTypes = useQuery({
    queryKey: roboticsKey('robot-types', workerBaseUrl),
    queryFn: () => {
      requireApiBase(workerBaseUrl, ROBOTICS_SERVICE)
      return fetchRobotTypes(workerBaseUrl)
    },
    enabled,
    retry: false,
  })
  const robotPorts = useQuery({
    queryKey: roboticsKey('robot-ports', workerBaseUrl),
    queryFn: () => {
      requireApiBase(workerBaseUrl, ROBOTICS_SERVICE)
      return fetchRobotPorts(workerBaseUrl)
    },
    enabled,
    retry: false,
  })
  const connect = useMutation({
    mutationFn: ({ type, port }: { type: string; port: string }) => {
      requireApiBase(workerBaseUrl, ROBOTICS_SERVICE)
      return setRobotType(workerBaseUrl, type, port || undefined)
    },
  })

  const [chosenType, setChosenType] = useState('')
  const [port, setPort] = useState('')

  const availableTypes = robotTypes.data?.types ?? KNOWN_ROBOT_TYPES
  // The first available type until one is chosen.
  const type = chosenType || availableTypes[0] || ''
  const reportedType = robotType.data?.type

  return {
    isPrerequisitesLoading: prerequisites.isLoading,
    prerequisites: prerequisites.data,
    isRobotTypeLoading: robotType.isLoading,
    /** True once the worker reports a real (non-"none") robot type. */
    robotTypeReady:
      !robotType.isLoading &&
      Boolean(reportedType && reportedType.toLowerCase() !== 'none'),
    availableTypes,
    availablePorts: robotPorts.data?.ports ?? [],
    type,
    setType: setChosenType,
    port,
    setPort,
    isConnecting: connect.isPending,
    connectError: connect.error
      ? connect.error instanceof TypeError
        ? 'Could not reach the worker. Please check the Worker URL and ensure the service is running.'
        : getErrorMessage(connect.error, 'Failed to set robot type.')
      : null,
    /** Sets the robot type and port on the worker, then `onConnected`. */
    connectRobot: (onConnected: () => void) => {
      if (!type || connect.isPending) return
      connect.mutate(
        { type, port },
        {
          onSuccess: async () => {
            await robotType.refetch()
            onConnected()
          },
        },
      )
    },
  }
}

export type RoboticsSetup = ReturnType<typeof useRoboticsSetup>
