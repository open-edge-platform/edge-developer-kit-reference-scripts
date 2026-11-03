// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { createContext, useContext } from 'react'

interface DemoRuntime {
  /**
   * The demo's instance can take requests. When false, a kept demo (`keepDemoWhenStopped`) disables
   * whatever sends a request but keeps its drafts and results readable.
   */
  available: boolean
}

const DemoRuntimeContext = createContext<DemoRuntime>({ available: true })

export const DemoRuntimeProvider = DemoRuntimeContext.Provider

/** Whether the demo's instance can take requests right now. */
export function useDemoRuntime(): DemoRuntime {
  return useContext(DemoRuntimeContext)
}
