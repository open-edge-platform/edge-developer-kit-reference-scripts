// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
} from 'react'

interface ConfigureOpener {
  register: (open: (() => void) | null) => void
  open: () => void
}

const ConfigureOpenerContext = createContext<ConfigureOpener | null>(null)

/**
 * Lets anything on a service page open the Runtime Settings sheet, which lives in the control bar's
 * Configure panel. That panel registers how to open it; the last one registered wins.
 */
export function ConfigureOpenerProvider({ children }: { children: ReactNode }) {
  const openRef = useRef<(() => void) | null>(null)
  const value: ConfigureOpener = {
    register: (open) => {
      openRef.current = open
    },
    open: () => openRef.current?.(),
  }
  return (
    <ConfigureOpenerContext.Provider value={value}>
      {children}
    </ConfigureOpenerContext.Provider>
  )
}

/** Registers `open` as the page's way to its Runtime Settings while mounted. */
export function useRegisterConfigureOpener(open: (() => void) | undefined) {
  const register = useContext(ConfigureOpenerContext)?.register
  useEffect(() => {
    if (!register || !open) return
    register(open)
    return () => register(null)
  }, [register, open])
}

/** Opens the page's Runtime Settings; `undefined` where there is none. */
export function useOpenConfigure(): (() => void) | undefined {
  return useContext(ConfigureOpenerContext)?.open
}
