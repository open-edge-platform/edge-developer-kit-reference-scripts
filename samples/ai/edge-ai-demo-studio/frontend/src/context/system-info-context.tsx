// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { createContext, type ReactNode, useContext } from 'react'
import { type SystemInfo, useSystemInfoQuery } from '@/hooks/use-system-info'

interface SystemInfoContextValue {
  systemInfo: SystemInfo | null
  loading: boolean
  /** The device check failed and nothing was loaded; `systemInfo` is null then. */
  error: boolean
  /** Runs the device check again. */
  retry: () => void
}

const SystemInfoContext = createContext<SystemInfoContextValue>({
  systemInfo: null,
  loading: true,
  error: false,
  retry: () => {},
})

export function SystemInfoProvider({ children }: { children: ReactNode }) {
  const { systemInfo, isLoading, isError, refetch } = useSystemInfoQuery()
  // The compiler keeps `value` stable while these are unchanged.
  const value: SystemInfoContextValue = {
    systemInfo,
    loading: isLoading,
    error: isError,
    retry: () => void refetch(),
  }

  return (
    <SystemInfoContext.Provider value={value}>
      {children}
    </SystemInfoContext.Provider>
  )
}

export function useSystemInfo() {
  return useContext(SystemInfoContext)
}
