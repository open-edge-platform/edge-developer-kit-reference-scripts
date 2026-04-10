// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { createContext, type ReactNode, useContext } from 'react'
import { type SystemInfo, useSystemInfoQuery } from '@/hooks/use-system-info'

interface SystemInfoContextValue {
  systemInfo: SystemInfo | null
  loading: boolean
}

const SystemInfoContext = createContext<SystemInfoContextValue>({
  systemInfo: null,
  loading: true,
})

export function SystemInfoProvider({ children }: { children: ReactNode }) {
  const { systemInfo, isLoading } = useSystemInfoQuery()

  return (
    <SystemInfoContext.Provider value={{ systemInfo, loading: isLoading }}>
      {children}
    </SystemInfoContext.Provider>
  )
}

export function useSystemInfo() {
  return useContext(SystemInfoContext)
}

export type { SystemInfo } from '@/hooks/use-system-info'
