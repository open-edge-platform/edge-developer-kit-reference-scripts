// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { createContext, type ReactNode, useContext } from 'react'
import type { SampleReadinessView } from './readiness'

/**
 * The demo shell's view of the workspace's services. When a required service drops out the
 * workspace stays mounted (drafts, results, scroll) and only the actions that need it pause.
 */
export interface SampleWorkspaceStatus {
  /** A required service is not online; requests that need it should wait. */
  suspended: boolean
  /** Names of the required services that are not online. */
  offlineRequired: string[]
  readiness: SampleReadinessView | null
}

const SampleWorkspaceContext = createContext<SampleWorkspaceStatus>({
  suspended: false,
  offlineRequired: [],
  readiness: null,
})

export function SampleWorkspaceProvider({
  value,
  children,
}: {
  value: SampleWorkspaceStatus
  children: ReactNode
}) {
  return (
    <SampleWorkspaceContext.Provider value={value}>
      {children}
    </SampleWorkspaceContext.Provider>
  )
}

/** The shell's view of this workspace's services; never suspended outside a sample demo. */
export function useSampleWorkspace(): SampleWorkspaceStatus {
  return useContext(SampleWorkspaceContext)
}
